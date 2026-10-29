import EnvironmentConditions from "@/components/EnvironmentConditions";

export default function EnvironmentPage() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <header>
        <h1 className="font-display text-[32px] font-extrabold">Environmental conditions</h1>
        <p className="text-mute">Explore air quality, weather forecasts and station availability.</p>
      </header>
      <EnvironmentConditions />
    </div>
  );
}
