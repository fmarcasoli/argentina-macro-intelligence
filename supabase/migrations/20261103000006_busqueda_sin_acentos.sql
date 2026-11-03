-- Búsqueda del catálogo sin distinguir acentos ni mayúsculas ("poblacion" encuentra "Población").
-- Función propia con translate() para no depender de la extensión unaccent.
create or replace function unaccent_text(t text) returns text
language sql immutable parallel safe as $$
  select translate(lower(t), 'áéíóúüñàèìòù', 'aeiouunaeiou')
$$;
