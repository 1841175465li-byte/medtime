// Explicit pre-1.7 user data used by existing regression tests. Production starts empty.
const S = require('../web/store.js');
function fixture() {
  const data = {version:3, medications:[
    {id:'minoxidil', name:'米诺地尔', icon:'pill'},
    {id:'isotretinoin', name:'异维A酸软胶囊', icon:'capsule'},
    {id:'finasteride', name:'非那雄胺', icon:'tablet'}
  ].map(m=>({...m, schedule:{mode:'none',slots:[],intervalDays:2,startDate:'1970-01-01',weekdays:[]},dose:null})), records:[]};
  return S.load({getItem:()=>JSON.stringify(data)});
}
fixture.legacy = (data, version) => ({version,
  medications:data.medications.map(({id,name,icon,schedule,dose})=>({id,name,icon,...(version>=2?{schedule:{mode:schedule.mode,slots:schedule.slots,intervalDays:schedule.intervalDays,startDate:schedule.startDate,weekdays:schedule.weekdays}}:{}),...(version>=3?{dose}:{})})),
  records:data.records.map(({id,medicationId,medicationName,takenAt,createdAt,note,slot,dose})=>({id,medicationId,medicationName,takenAt,createdAt,note,...(version>=2?{slot}:{}),...(version>=3?{dose}:{})}))
});
module.exports = fixture;
