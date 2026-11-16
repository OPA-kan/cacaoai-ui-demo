// Historical production records imported from Cacao-Records.html.
// Supabase harvest_records take precedence when the same date is recorded there.
window.cacaoaiBuiltInHarvestRecords = [
  { id:'cacao-2025-11-25', date:'2025-11-25', pods:728, weightKg:null, source:'Cacao Records' },
  { id:'cacao-2025-12-18', date:'2025-12-18', pods:900, weightKg:63.19, source:'Cacao Records' },
  { id:'cacao-2025-12-30', date:'2025-12-30', pods:700, weightKg:62.6, source:'Cacao Records' },
  { id:'cacao-2026-01-08', date:'2026-01-08', pods:680, weightKg:43.9, source:'Cacao Records' },
  { id:'cacao-2026-01-22', date:'2026-01-22', pods:739, weightKg:58, source:'Cacao Records' },
  { id:'cacao-2026-02-12', date:'2026-02-12', pods:716, weightKg:54.41, source:'Cacao Records' },
  { id:'cacao-2026-03-12', date:'2026-03-12', pods:891, weightKg:74.56, source:'Cacao Records' },
  { id:'cacao-2026-04-16', date:'2026-04-16', pods:1820, weightKg:143.08, source:'Cacao Records' },
  { id:'cacao-2026-05-22', date:'2026-05-22', pods:1604, weightKg:129, source:'Cacao Records' },
  { id:'cacao-2026-06-09', date:'2026-06-09', pods:434, weightKg:35.15, source:'Cacao Records' },
  { id:'cacao-2026-07-01', date:'2026-07-01', pods:634, weightKg:24.3, source:'Cacao Records' }
];

window.cacaoaiProductionProcessRecords = {
  fermentation: [
    { batch:'H0312', date:'2026-03-12', quantity:'74.56 kg wet beans', checkpoints:'Mar 17–18: 49.9°C / 47.8°C peak range', status:'Collected Apr 5', note:'Four containers; B3 was released Mar 23 and later noted as over-fermented.' },
    { batch:'H0416', date:'2026-04-16', quantity:'143.08 kg wet beans', checkpoints:'Apr 17–26: 30.6–48.8°C', status:'Drying started Apr 28–30', note:'Six B1–B6 lots with daily color, smell, and condition checks.' },
    { batch:'H0522', date:'2026-05-22', quantity:'129 kg wet beans', checkpoints:'May 25–27: up to 50.0°C', status:'Released May 31', note:'Five W1–W5 lots; C3 was kept earlier than the other containers.' },
    { batch:'H0609', date:'2026-06-09 / Jul 1', quantity:'35.15 kg wet beans', checkpoints:'Moved to jute bag Jun 14', status:'Drying started Jun 21', note:'The source log contains a date discrepancy; the main record identifies Jul 1 as the harvest.' }
  ],
  drying: [
    { batch:'H0416 B2, B4', start:'Apr 28, 2026', kept:'May 18, 2026', days:'21', note:'Cacao' },
    { batch:'H0416 B3, B5', start:'Apr 28, 2026', kept:'May 28, 2026', days:'31', note:'Cacao' },
    { batch:'H0416 B1', start:'Apr 30, 2026', kept:'May 28, 2026', days:'29', note:'Cacao' },
    { batch:'H0522 C1, C2, C4', start:'May 31, 2026', kept:'Jun 18, 2026', days:'19', note:'Cacao' },
    { batch:'H0522 C3', start:'May 31, 2026', kept:'Jun 15, 2026', days:'16', note:'Kept earlier than the other H0522 containers' },
    { batch:'H0609', start:'Jun 21, 2026', kept:'Jul 1, 2026', days:'10', note:'Rain noted Jun 26 and Jun 29; temporary keep Jun 30' },
    { batch:'Mango', start:'May 1, 2026', kept:'May 5, 2026', days:'5', note:'Dried mango' }
  ],
  dried: [
    { batch:'F1129-B', total:'—', used:'2.592 kg · Feb 27, 2026', note:'Total not recorded' },
    { batch:'H0108', total:'9.5 kg', used:'—', note:'Dried beans' },
    { batch:'H1218', total:'1.772 kg', used:'—', note:'Dried beans' },
    { batch:'H1230', total:'1.328 kg', used:'573 g · Mar 18, 2026', note:'Dried beans' },
    { batch:'F1214', total:'—', used:'2.001 kg · Mar 18, 2026', note:'Total not recorded' },
    { batch:'F1228', total:'2.037 kg', used:'—', note:'Dried beans' },
    { batch:'H0416 B2, B4', total:'13.662 kg', used:'—', note:'3.735 kg + 9.927 kg; other H0416 bins not recorded' },
    { batch:'H0522 C1–C4', total:'47.555 kg', used:'—', note:'Weights may be before or after drying' }
  ]
};
