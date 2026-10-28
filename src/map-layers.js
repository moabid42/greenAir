// The values are citywide context, never estimates for individual roads.
export const layerDefinitions = {
  overall:{label:'Suitability',unit:'score/100'},
  heat:{label:'Temperature',category:'weather',key:'temperature'},
  air:{label:'PM2.5',category:'air',key:'pm25'},
  wind:{label:'Wind speed',category:'weather',key:'windSpeed'},
  traffic:{label:'Traffic exposure',category:'traffic',key:'trafficExposureScore'},
  safety:{label:'Safety'}, surface:{label:'Surface'}
};
export function layerMetric(layer,slice,activity){
  if(layer==='overall') return slice?.sportSuitability?.[activity] || null;
  const definition=layerDefinitions[layer];
  return definition?.category ? slice?.[definition.category]?.[definition.key] || null : null;
}
export function layerColor(layer,metric){
  if(!metric || metric.value==null) return '#8b9e96';
  const v=metric.value;
  if(layer==='overall') return v>=75?'#14966f':v>=60?'#dbad36':'#e47152';
  if(layer==='heat') return v<15?'#4b9fac':v<25?'#dbad36':'#e47152';
  if(layer==='air') return v<10?'#14966f':v<25?'#dbad36':'#e47152';
  if(layer==='wind') return v<15?'#14966f':v<30?'#dbad36':'#e47152';
  if(layer==='traffic') return v<40?'#14966f':v<70?'#dbad36':'#e47152';
  return '#8b9e96';
}
