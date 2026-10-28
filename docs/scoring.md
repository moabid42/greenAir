# Heilbronn Sports-Suitability Score: How the Scoring Works

*Version 0.1, 2026-10-28. All constants are defaults to tune, not measured truths.*

> Team draft added to the repository unchanged. The implemented subset is listed
> in [Implementation status](#implementation-status) at the end.

## 1. The idea

Every phenomenon that matters is either slow in space or fast in time, never both at once in our data. Mobile sensors (bikes, walks) tell us which streets are worse than others; stationary sensors (home boxes, official stations, DWD) tell us what the level is this hour. The score combines them:

$$
\hat{x}(s,t) = \underbrace{L(t)}_{\text{level, city-wide, per hour}} \times \underbrace{R_s}_{\text{pattern, per segment, slow}}
$$

for multiplicative quantities such as particulate matter, and

$$
\hat{T}(s,t) = T_{\text{city}}(t) + \Delta T_s
$$

for additive ones such as temperature. Static attributes (surface, overtaking risk) are per-segment constants. The final score is a weighted sum of goodness functions over all components, multiplied by hard gates (rain, extreme pollution) and reported together with a confidence.

## 2. Notation

| Symbol | Meaning |
|---|---|
| $s$ | an OSM street segment |
| $t$ | an hour (UTC) |
| $p$ | a sport profile (running, road cycling, walking/outdoor strength) |
| $x_i, t_i$ | one mobile sample value and its timestamp |
| $n_s$ | number of mobile samples matched to segment $s$ |
| $L(t)$ | city-level value of a phenomenon at hour $t$ |
| $R_s$ | multiplicative spatial pattern (ratio) of segment $s$ |
| $\Delta T_s$ | additive temperature anomaly of segment $s$ |
| $f_k(\cdot)$ | goodness function for component $k$, in $[0,1]$ |
| $w_{p,k}$ | weight of component $k$ in profile $p$ |
| $G_g$ | gate $g$, in $\{0,1\}$ or $[0,1]$ |
| $S(s,t,p)$ | score, 0–100 |
| $C(s,t)$ | confidence, 0–1 |

## 3. Spatial pattern

### 3.1 PM ratio from bike samples

Each bike sample is compared to the city level *at the moment it was taken*, which removes the bias from when people chose to ride:

$$
r_i = \frac{x_i}{L(t_i)}, \qquad \tilde{R}_s = \operatorname{median}_{i \in s} \; r_i
$$

Samples are matched to the nearest segment within 20 m (the ATRAI rule) and samples with relative humidity above 75 % are dropped (also the ATRAI rule, because low-cost optical PM sensors overread when humid).

Segments with few samples are shrunk toward "no difference" ($R=1$) in log space:

$$
R_s = \exp\!\left( \frac{n_s}{n_s + \kappa} \, \ln \tilde{R}_s \right), \qquad \kappa \approx 20
$$

A segment with 2 samples and a median ratio of 2.0 gets $R_s = \exp(\tfrac{2}{22}\ln 2) \approx 1.07$; with 200 samples it gets $\approx 1.94$.

Patterns are computed per season (winter / summer) once enough data exists, because heating-season PM is spatially different from traffic PM.

### 3.2 Temperature anomaly from heat walks and home boxes

$$
\Delta T_s = \frac{n_s}{n_s + \kappa} \; \operatorname{median}_{i \in s} \left( T_i - T_{\text{ref}}(t_i) \right)
$$

where $T_{\text{ref}}$ is the DWD station (rural reference, ~10 km away) or the median of live home boxes. Two anomalies are kept separately and never averaged: *daytime summer* (from the heat walks) and *night* (from home boxes), because they measure different urban-heat mechanisms.

### 3.3 Static attributes

Taken directly from the ATRAI layers, per segment:

- Roughness $\rho_s \in [0,1]$ (normalized, from `bumpy_roads`); fallback from the OSM `surface` tag where no bike passed.
- Close-overtaking share $q_s = \dfrac{\#\{\text{overtakes} < 150\,\text{cm}\}}{\#\{\text{overtakes}\}}$ from the `overtaking_distance` histogram.
- Flow $\phi_s \in [0,1]$ from `traffic_flow` (0 = stop-and-go, 1 = free-moving).

### 3.4 Fallback for uncovered segments

Segments with $n_s = 0$ get an inverse-distance-weighted estimate from the $J$ nearest stationary boxes (or neighboring covered segments):

$$
\hat{R}_s = \frac{\sum_{j} d_{sj}^{-2} \, R_j}{\sum_{j} d_{sj}^{-2}}, \qquad R_j = \frac{\bar{x}_j}{\bar{L}}
$$

with $R_j$ the box's long-run ratio to the city level. Confidence is lowered accordingly (§6.3).

### 3.5 Optional: rush-hour contrast

Street-to-street PM contrast is larger in rush hour than at night. If desired, modulate the pattern's strength by the NO₂ diurnal profile (NO₂ is the traffic tracer):

$$
\hat{x}_{PM}(s,t) = \hat{L}_{PM}(t) \cdot R_s^{\gamma(t)}, \qquad \gamma(t) = 0.5 + \frac{\bar{L}_{NO_2}(h_t, d_t)}{\max_{h,d} \bar{L}_{NO_2}(h,d)}
$$

so $\gamma \in [0.5, 1.5]$. Default $\gamma = 1$ until validated.

## 4. Temporal level

### 4.1 Now

Each live home box $j$ is calibrated against the official reference station by a linear fit on overlapping history ($x_{\text{ref}} \approx \alpha_j x_j + \beta_j$). The current level is the median over live boxes:

$$
L(t) = \operatorname{median}_{j \in \text{live}(t)} \left( \alpha_j x_j(t) + \beta_j \right)
$$

If no box is live, $L(t)$ is the reference station itself. "Live" means a reading within the last 30 minutes and no stuck-sensor flag.

### 4.2 Climatology

For each phenomenon, a typical level by hour-of-day $h$ and weekday $d$ over the last $N$ weeks (target $N \ge 8$):

$$
\bar{L}(h,d) = \operatorname{median} \{ L(t) : \text{hour}(t) = h,\ \text{weekday}(t) = d \}
$$

This is also the rush-hour prior used in §3.5.

### 4.3 Forecast

With a model forecast $M(t)$ available (Open-Meteo for air quality, DWD/Bright Sky for weather), apply a bias correction from the last 24 h:

$$
\hat{L}(t_0 + \tau) = M(t_0 + \tau) \cdot b(t_0), \qquad b(t_0) = \frac{\operatorname{mean}_{u \in [t_0 - 24\text{h},\, t_0]} L(u)}{\operatorname{mean}_{u \in [t_0 - 24\text{h},\, t_0]} M(u)}
$$

Without a model, use climatology with today's anomaly decaying over time:

$$
\hat{L}(t_0 + \tau) = \bar{L}(h,d) \cdot \left( \frac{L(t_0)}{\bar{L}(h_{t_0}, d_{t_0})} \right)^{e^{-\tau / \tau_0}}, \qquad \tau_0 \approx 6\,\text{h}
$$

### 4.4 Apparent temperature

Heat stress depends on humidity and wind, not just temperature. Using the Steadman apparent-temperature form (constants to verify against the source):

$$
e = \frac{\mathrm{RH}}{100} \cdot 6.105 \cdot \exp\!\left( \frac{17.27\, T}{237.7 + T} \right), \qquad
AT = T + 0.33\, e - 0.70\, v - 4.00
$$

with $T$ in °C, $e$ the vapour pressure in hPa, $v$ the wind speed in m/s. Compute $AT$ from $\hat{T}(s,t)$, forecast humidity and wind.

## 5. Component goodness functions $f_k$

All $f_k$ map a physical value to $[0,1]$, where 1 is ideal.

### 5.1 Lower-is-better (linear ramp)

$$
f(x) = \operatorname{clip}\!\left( \frac{x_{\text{bad}} - x}{x_{\text{bad}} - x_{\text{good}}},\ 0,\ 1 \right)
$$

| Component | $x_{\text{good}}$ | $x_{\text{bad}}$ | Unit | Anchor rationale |
|---|---|---|---|---|
| PM2.5 | 5 | 35 | µg/m³ | WHO 2021 annual guideline 5, 24 h guideline 15 (verify) |
| PM10 | 15 | 70 | µg/m³ | WHO 24 h guideline 45 |
| NO₂ | 10 | 60 | µg/m³ | WHO 24 h guideline 25 |
| O₃ | 60 | 140 | µg/m³ | WHO 8 h guideline 100 |
| Wind | 10 | 45 | km/h | comfort; cycling more sensitive |
| UV index | 2 | 8 | — | sun exposure |
| Close-overtaking share $q_s$ | 0.10 | 0.60 | — | 1.5 m legal minimum |
| Crowding | 0.2 | 0.9 | percentile of hour-of-week counts | relative to the counter's own history |

### 5.2 Direct

$$
f_{\text{surface}} = 1 - \rho_s, \qquad f_{\text{flow}} = \phi_s, \qquad f_{\text{daylight}} = \begin{cases} 1 & \text{daylight} \\ \delta_p & \text{night} \end{cases}
$$

with $\delta_p = 0.5$ for running and cycling on unlit paths, 0.8 otherwise.

### 5.3 Trapezoid for apparent temperature

$$
f_T(AT) = \begin{cases}
0 & AT \le a \\[2pt]
\dfrac{AT - a}{b - a} & a < AT < b \\[6pt]
1 & b \le AT \le c \\[2pt]
\dfrac{d - AT}{d - c} & c < AT < d \\[6pt]
0 & AT \ge d
\end{cases}
$$

| Profile | $a$ | $b$ | $c$ | $d$ |
|---|---|---|---|---|
| Running | −5 | 5 | 15 | 28 |
| Road cycling | 0 | 10 | 22 | 32 |
| Walking / outdoor strength | −2 | 8 | 24 | 32 |

These are rough comfort bands, not physiological constants.

### 5.4 Gates

Gates zero the score instead of weighting it:

$$
G_{\text{rain}} = \mathbb{1}[P(t) < P_p], \qquad
G_{\text{air}} = \mathbb{1}[\hat{x}_{PM2.5}(s,t) < 75], \qquad
G_{\text{alert}} = \mathbb{1}[\text{no official severe-weather alert}]
$$

with $P_p$ = 1 mm/h for road cycling, 3 mm/h for running and walking. A soft rain gate is an alternative: $G_{\text{rain}} = \left(1 + (P/P_p)^4\right)^{-1}$.

## 6. Final score

### 6.1 Weighted sum

$$
S(s,t,p) = 100 \cdot \prod_g G_g(s,t,p) \cdot \frac{\sum_{k \in K(s,t)} w_{p,k} \, f_k\!\left(\hat{x}_k(s,t)\right)}{\sum_{k \in K(s,t)} w_{p,k}}
$$

$K(s,t)$ is the set of components with data. Missing components are dropped from both sums (the score renormalizes) and reduce confidence.

### 6.2 Default weights $w_{p,k}$

| Component | Running | Road cycling | Walking / strength |
|---|---|---|---|
| PM2.5 | 3 | 3 | 2 |
| NO₂ | 1 | 1 | 1 |
| O₃ | 2 | 2 | 1 |
| Apparent temperature | 3 | 2 | 2 |
| Wind | 1 | 2 | 1 |
| UV | 1 | 1 | 2 |
| Pollen (sensitive users only) | 0 → 2 | 0 → 2 | 0 → 2 |
| Surface | 2 | 2 | 0.5 |
| Overtaking | 0 | 3 | 0 |
| Flow | 1 | 2 | 0 |
| Crowding | 1 | 1 | 1 |
| Daylight | 1 | 1 | 1 |

### 6.3 Confidence

$$
C(s,t) = \min\!\left( \underbrace{1 - e^{-n_s/\kappa}}_{\text{coverage}},\ \underbrace{e^{-d_s / d_0}}_{\text{station proximity}},\ \underbrace{e^{-\tau / \tau_c}}_{\text{forecast horizon}} \right)
$$

with $d_s$ the distance to the nearest live station, $d_0 \approx 3$ km, $\tau$ the hours ahead, $\tau_c \approx 12$ h. IDW-filled segments use $n_s = 0 \Rightarrow$ coverage term replaced by a fixed 0.3. The map renders color by $S$ and opacity by $C$.

## 7. Best time and routes

$$
t^*(s,p) = \arg\max_{t \in [t_0,\, t_0 + 24\text{h}]} S(s,t,p)
$$

Report the top three windows of at least one hour, not just the single maximum.

For a route $\rho$ (ordered segments with lengths $\ell_s$):

$$
S_\rho(t,p) = \frac{\sum_{s \in \rho} \ell_s \, S(s,t,p)}{\sum_{s \in \rho} \ell_s}, \qquad C_\rho(t) = \min_{s \in \rho} C(s,t)
$$

## 8. Worked example

Segment with $n_s = 40$ bike samples, $\tilde{R}_s = 1.3$; profile = running; hour = 17:00, one hour ahead.

Pattern: $R_s = \exp(\tfrac{40}{60} \ln 1.3) = e^{0.175} \approx 1.19$.

Level forecast: $\hat{L}_{PM2.5} = 18$ µg/m³ → $\hat{x}_{PM2.5} = 18 \times 1.19 \approx 21.4$ → $f = \tfrac{35 - 21.4}{30} \approx 0.45$.

Heat: $T_{\text{city}} = 22$, $\Delta T_s = +1.5$ → 23.5 °C; RH 50 %, wind 3 m/s → $e \approx 14.4$ hPa, $AT \approx 23.5 + 4.76 - 2.1 - 4.0 = 22.2$ → $f_T = \tfrac{28 - 22.2}{13} \approx 0.45$.

Other components: NO₂ 25 → 0.70; O₃ 90 → 0.63; wind 10.8 km/h → 0.98; UV 3 → 0.83; roughness 0.2 → 0.80; flow 0.7 → 0.70; crowding 60th percentile → 0.43; daylight → 1.

Weighted sum (running weights, total 16):

$$
\frac{3(0.45) + 1(0.70) + 2(0.63) + 3(0.45) + 1(0.98) + 1(0.83) + 2(0.80) + 1(0.70) + 1(0.43) + 1(1.0)}{16} \approx \frac{10.2}{16} \approx 0.64
$$

Gates all 1 → $S \approx 64$.

Confidence: coverage $1 - e^{-2} = 0.86$; station 1.2 km away → $e^{-0.4} = 0.67$; horizon 1 h → $0.92$. $C = 0.67$.

Same segment at 07:00: PM level 28 (rush) → $\hat{x} = 33.3$, $f \approx 0.06$; $AT \approx 13$ → $f_T = 0.80$; crowding lower. Net effect is lower, so the best-time search prefers late afternoon for this segment despite the warmer temperature. A park path with $R_s = 0.8$ would flip that.

## 9. Assumptions and limits

1. The PM pattern is a dry-daytime pattern: no bike data above 75 % humidity and almost none at night.
2. NO₂ has no street-level measurement; its spatial pattern is a traffic prior, not data.
3. Low-cost PM absolute values are unreliable without station calibration; ratios are more robust.
4. Daytime and nighttime heat anomalies come from different mechanisms and are kept separate.
5. All anchor values, weights and trapezoid bands are starting points; tune against user feedback or held-out station data.
6. Segments below a minimum box count are suppressed for privacy (32 riders in the campaign).
7. Model air quality (Open-Meteo) is ~10 km resolution; it supplies the horizon, never the pattern.

## Implementation status

`services/backend/app/scoring/` implements the pure formulas, with the worked
example (§8) as a regression test: §3.1/§3.2 shrinkage, §3.4 IDW, §4.4, §5,
§6.1–6.3, §7. The processing modules implement segment matching and patterns
(§3.1–§3.4), calibration and levels (§4.1), climatology (§4.2), forecasts (§4.3),
the optional §3.5 rush-hour contrast (off by default) and the engine that
combines them; see [processing](processing.md).

Not implemented: separate day/night heat anomalies (§3.2), seasonal patterns
(§3.1), pollen anchors (weight 0 by default), crowding (no counter source yet),
and API endpoints (serving is outside the processing box).

Open points found while implementing (2026-10-28):

- §3.1 example: with 200 samples the formula gives $R_s = 2^{200/220} \approx 1.88$,
  not 1.94. The code follows the formula.
- PM10 has §5.1 anchors but no §6.2 weight, so it does not affect the score.
- §5.2 night factor: the code reads "otherwise" as walking, or any profile on
  a lit path (0.8).
- §7 "windows of at least one hour": the code returns the best single hours and
  skips the direct neighbours of a chosen hour, so the windows are distinct.
