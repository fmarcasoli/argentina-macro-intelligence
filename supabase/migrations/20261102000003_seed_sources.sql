-- Fuentes oficiales y configuración global inicial.
insert into sources (id, name, institution, api_name, base_url, docs_url, auth_required, rate_limit_note, notes)
values
  ('BCRA',
   'Banco Central de la República Argentina',
   'BCRA',
   'API de Estadísticas Monetarias v4.0',
   'https://api.bcra.gob.ar/estadisticas/v4.0',
   'https://www.bcra.gob.ar/apis-banco-central/',
   false,
   'Sin límite publicado. Máx. 3000 registros por llamada (Limit). La plataforma espacia las llamadas.',
   'Series diarias fechadas por día; series mensuales fechadas a fin de mes. Algunas series (CER, UVA, UVI, ICL) se publican con fechas futuras.'),
  ('INDEC',
   'Instituto Nacional de Estadística y Censos',
   'INDEC',
   'API de Series de Tiempo de la República Argentina (datos.gob.ar)',
   'https://apis.datos.gob.ar/series/api',
   'https://datosgobar.github.io/series-tiempo-ar-api/',
   false,
   'Sin límite publicado. Máx. 5000 valores por serie por llamada (limit) y 40 series por llamada (verificado).',
   'El INDEC no expone una API propia: publica sus series a través de la API oficial de Series de Tiempo del Estado Nacional. Fechas = primer día del período.')
on conflict (id) do update set
  name = excluded.name, institution = excluded.institution, api_name = excluded.api_name,
  base_url = excluded.base_url, docs_url = excluded.docs_url, auth_required = excluded.auth_required,
  rate_limit_note = excluded.rate_limit_note, notes = excluded.notes;

insert into app_settings (key, value, description) values
  ('sync.revision_lookback', '{"D": 45, "W": 120, "M": 730, "Q": 1460, "S": 1460, "A": 2920}',
   'Días hacia atrás que se vuelven a descargar en cada actualización incremental, por frecuencia, para capturar revisiones.'),
  ('sync.stale_after_days', '{"D": 7, "W": 21, "M": 75, "Q": 200, "S": 380, "A": 730}',
   'Días sin datos nuevos a partir de los cuales una serie se marca como desactualizada.')
on conflict (key) do nothing;
