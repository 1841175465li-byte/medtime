/* Offline name lookup only. No doses, recommended frequencies or treatment advice. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedCatalog = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var categories = [
    ['cardio', '血压与心血管'], ['glucose', '血糖管理'], ['lipids', '血脂管理'],
    ['endocrine', '甲状腺与骨骼'], ['respiratory', '呼吸与过敏'], ['digestive', '消化与肝脏'],
    ['neuro', '神经与精神'], ['rheumatic', '风湿与痛风'], ['skin', '皮肤与毛发'], ['other', '泌尿与眼科'],
    ['supplements', '保健品与营养补充']
  ].map(function (item) { return Object.freeze({id:item[0], name:item[1]}); });
  // Names checked against the NHC 2018 National Essential Medicines List,
  // except the original user-provided minoxidil / isotretinoin entries.
  // Broad groups are for browsing; a medicine can have more than one use.
  var rows = [
    ['amlodipine','氨氯地平','an lu di ping','cardio'],
    ['levamlodipine','左氨氯地平','zuo an lu di ping','cardio'],
    ['nifedipine','硝苯地平','xiao ben di ping','cardio'],
    ['felodipine','非洛地平','fei luo di ping','cardio'],
    ['valsartan','缬沙坦','xie sha tan','cardio'],
    ['valsartan-amlodipine','缬沙坦氨氯地平','xie sha tan an lu di ping','cardio'],
    ['enalapril','依那普利','yi na pu li','cardio'],
    ['lisinopril','赖诺普利','lai nuo pu li','cardio'],
    ['bisoprolol','比索洛尔','bi suo luo er','cardio'],
    ['metoprolol','美托洛尔','mei tuo luo er','cardio'],
    ['indapamide','吲达帕胺','yin da pa an','cardio'],
    ['hydrochlorothiazide','氢氯噻嗪','qing lu sai qin','cardio'],
    ['spironolactone','螺内酯','luo nei zhi','cardio'],
    ['aspirin','阿司匹林','a si pi lin','cardio'],
    ['clopidogrel','氯吡格雷','lu bi ge lei','cardio'],
    ['rivaroxaban','利伐沙班','li fa sha ban','cardio'],
    ['metformin','二甲双胍','er jia shuang gua','glucose'],
    ['acarbose','阿卡波糖','a ka bo tang','glucose'],
    ['glimepiride','格列美脲','ge lie mei niao','glucose'],
    ['gliclazide','格列齐特','ge lie qi te','glucose'],
    ['glipizide','格列吡嗪','ge lie bi qin','glucose'],
    ['repaglinide','瑞格列奈','rui ge lie nai','glucose'],
    ['pioglitazone','吡格列酮','bi ge lie tong','glucose'],
    ['sitagliptin','西格列汀','xi ge lie ting','glucose'],
    ['linagliptin','利格列汀','li ge lie ting','glucose'],
    ['dapagliflozin','达格列净','da ge lie jing','glucose'],
    ['liraglutide','利拉鲁肽','li la lu tai','glucose'],
    ['insulin-glargine','甘精胰岛素','gan jing yi dao su','glucose'],
    ['atorvastatin','阿托伐他汀','a tuo fa ta ting','lipids'],
    ['rosuvastatin','瑞舒伐他汀','rui shu fa ta ting','lipids'],
    ['simvastatin','辛伐他汀','xin fa ta ting','lipids'],
    ['fenofibrate','非诺贝特','fei nuo bei te','lipids'],
    ['levothyroxine','左甲状腺素钠','zuo jia zhuang xian su na','endocrine'],
    ['thiamazole','甲巯咪唑','jia qiu mi zuo','endocrine'],
    ['propylthiouracil','丙硫氧嘧啶','bing liu yang mi ding','endocrine'],
    ['alendronate','阿仑膦酸钠','a lun lin suan na','endocrine'],
    ['alfacalcidol','阿法骨化醇','a fa gu hua chun','endocrine'],
    ['ergocalciferol','维生素D2','wei sheng su d 2','endocrine'],
    ['budesonide','布地奈德','bu di nai de','respiratory'],
    ['budesonide-formoterol','布地奈德福莫特罗','bu di nai de fu mo te luo','respiratory'],
    ['fluticasone-propionate','丙酸氟替卡松','bing suan fu ti ka song','respiratory'],
    ['tiotropium','噻托溴铵','sai tuo xiu an','respiratory'],
    ['ipratropium','异丙托溴铵','yi bing tuo xiu an','respiratory'],
    ['loratadine','氯雷他定','lu lei ta ding','respiratory'],
    ['mesalazine','美沙拉嗪','mei sha la qin','digestive','美沙拉秦'],
    ['sulfasalazine','柳氮磺吡啶','liu dan huang bi ding','digestive'],
    ['omeprazole','奥美拉唑','ao mei la zuo','digestive'],
    ['lactulose','乳果糖','ru guo tang','digestive'],
    ['ursodeoxycholic-acid','熊去氧胆酸','xiong qu yang dan suan','digestive'],
    ['entecavir','恩替卡韦','en ti ka wei','digestive'],
    ['fluoxetine','氟西汀','fu xi ting','neuro'],
    ['paroxetine','帕罗西汀','pa luo xi ting','neuro'],
    ['escitalopram','艾司西酞普兰','ai si xi tai pu lan','neuro'],
    ['venlafaxine','文拉法辛','wen la fa xin','neuro'],
    ['mirtazapine','米氮平','mi dan ping','neuro'],
    ['carbamazepine','卡马西平','ka ma xi ping','neuro'],
    ['lamotrigine','拉莫三嗪','la mo san qin','neuro'],
    ['oxcarbazepine','奥卡西平','ao ka xi ping','neuro'],
    ['levodopa-benserazide','多巴丝肼','duo ba si jing','neuro'],
    ['pramipexole','普拉克索','pu la ke suo','neuro'],
    ['allopurinol','别嘌醇','bie piao chun','rheumatic'],
    ['benzbromarone','苯溴马隆','ben xiu ma long','rheumatic'],
    ['hydroxychloroquine','羟氯喹','qiang lu kui','rheumatic'],
    ['leflunomide','来氟米特','lai fu mi te','rheumatic'],
    ['minoxidil','米诺地尔','mi nuo di er','skin'],
    ['isotretinoin','异维A酸软胶囊','yi wei a suan ruan jiao nang','skin','异维A酸'],
    ['finasteride','非那雄胺','fei na xiong an','skin','非那雄安'],
    ['tamsulosin','坦索罗辛','tan suo luo xin','other','坦洛新|tan luo xin|tlx'],
    ['terazosin','特拉唑嗪','te la zuo qin','other'],
    ['timolol','噻吗洛尔','sai ma luo er','other'],
    // Supplement ingredients/product types, not treatment recommendations.
    ['multivitamin','复合维生素','fu he wei sheng su','supplements','多种维生素|综合维生素|维他命'],
    ['vitamin-b-complex','复合维生素B','fu he wei sheng su b','supplements','维生素B族|B族维生素'],
    ['vitamin-b1','维生素B1','wei sheng su b 1','supplements','维他命B1'],
    ['vitamin-b2','维生素B2','wei sheng su b 2','supplements','维他命B2'],
    ['vitamin-b6','维生素B6','wei sheng su b 6','supplements','维他命B6'],
    ['vitamin-b12','维生素B12','wei sheng su b 1 2','supplements','维他命B12'],
    ['vitamin-c','维生素C','wei sheng su c','supplements','维他命C|VC'],
    ['vitamin-d3','维生素D3','wei sheng su d 3','supplements','维他命D3|VD3'],
    ['vitamin-e','维生素E','wei sheng su e','supplements','维他命E|VE'],
    ['calcium-supplement','钙补充剂','gai bu chong ji','supplements','钙片'],
    ['iron-supplement','铁补充剂','tie bu chong ji','supplements','铁剂'],
    ['zinc-supplement','锌补充剂','xin bu chong ji','supplements','锌片'],
    ['magnesium-supplement','镁补充剂','mei bu chong ji','supplements','镁片'],
    ['fish-oil','鱼油','yu you','supplements','深海鱼油|Omega3|Omega-3|欧米伽3'],
    ['algal-dha','藻油DHA','zao you d h a','supplements','藻油|DHA'],
    ['coenzyme-q10','辅酶Q10','fu mei q 1 0','supplements','CoQ10|Q10'],
    ['lutein','叶黄素','ye huang su','supplements'],
    ['probiotics','益生菌','yi sheng jun','supplements'],
    ['glucosamine','氨基葡萄糖','an ji pu tao tang','supplements','氨糖'],
    ['protein-powder','蛋白粉','dan bai fen','supplements','乳清蛋白|protein']
  ];
  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFKC').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s·\-]/g, '');
  }
  var originals = ['minoxidil','isotretinoin','finasteride'];
  var items = rows.map(function (row) {
    var syllables = row[2].split(' ');
    var category = categories.find(function (item) { return item.id === row[3]; });
    return Object.freeze({
      id:originals.indexOf(row[0]) >= 0 ? row[0] : 'catalog:' + row[0],
      name:row[1], category:row[3], categoryName:category.name,
      icon:row[0] === 'isotretinoin' ? 'capsule' : row[0] === 'finasteride' ? 'tablet' : 'pill',
      keys:Object.freeze([row[1], row[0], row[2], row[2].replace(/\blu\b/g, 'lv'), syllables.map(function (s) { return s[0]; }).join(''), category.name]
        .concat(row[4] ? row[4].split('|') : []).map(normalize))
    });
  });
  function matches(item, query) {
    var key = normalize(query);
    return !key || item.keys.some(function (value) { return value.indexOf(key) >= 0; });
  }
  function search(query, category) {
    var key = normalize(query);
    return items.filter(function (item) { return (!category || item.category === category) && matches(item, key); })
      .sort(function (a, b) {
        // Put an exact base name ahead of combination products containing it.
        var rank = function (item) { return item.keys.indexOf(key) >= 0 ? 0 : 1; };
        return rank(a) - rank(b);
      });
  }
  function findAdded(item, medications) {
    // Keep the catalog association after a user refines the display name.
    // Never equate different dosage forms using substring or fuzzy matching.
    return medications.find(function (med) { return med.id === item.id || normalize(med.name) === normalize(item.name); });
  }
  function matchesMedication(medication, query) {
    if (normalize(medication.name).indexOf(normalize(query)) >= 0) return true;
    var item = items.find(function (entry) { return entry.id === medication.id || normalize(entry.name) === normalize(medication.name); });
    return Boolean(item && matches(item, query));
  }
  return Object.freeze({items:Object.freeze(items), categories:Object.freeze(categories), normalize:normalize,
    search:search, findAdded:findAdded, matchesMedication:matchesMedication});
});
