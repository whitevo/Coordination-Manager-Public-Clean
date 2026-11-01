SELECT md5(COALESCE(string_agg(item, E'\n' ORDER BY item), ''))
FROM (
  SELECT 'relation:' || n.nspname || '.' || c.relname || ':' ||
      c.relkind::text || ':' || c.relrowsecurity::text || ':' ||
      c.relforcerowsecurity::text || ':' || COALESCE(c.relacl::text, '') AS item
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'private', 'extensions')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  UNION ALL
  SELECT 'column:' || table_schema || '.' || table_name || '.' ||
      column_name || ':' || data_type || ':' || is_nullable || ':' ||
      COALESCE(column_default, '')
  FROM information_schema.columns
  WHERE table_schema IN ('public', 'private', 'extensions')
  UNION ALL
  SELECT 'constraint:' || n.nspname || '.' || t.relname || '.' ||
      con.conname || ':' || con.convalidated::text || ':' ||
      pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class t ON t.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname IN ('public', 'private', 'extensions')
  UNION ALL
  SELECT 'index:' || schemaname || '.' || tablename || '.' || indexname ||
      ':' || indexdef
  FROM pg_indexes
  WHERE schemaname IN ('public', 'private', 'extensions')
  UNION ALL
  SELECT 'policy:' || schemaname || '.' || tablename || '.' || policyname ||
      ':' || permissive || ':' || roles::text || ':' || cmd || ':' ||
      COALESCE(qual, '') || ':' || COALESCE(with_check, '')
  FROM pg_policies
  WHERE schemaname IN ('public', 'private', 'extensions')
  UNION ALL
  SELECT 'function:' || n.nspname || '.' || p.proname || '(' ||
      pg_get_function_identity_arguments(p.oid) || '):' ||
      p.prosecdef::text || ':' || COALESCE(array_to_string(p.proconfig, ','), '') ||
      ':' || COALESCE(p.proacl::text, '') || ':' || pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private', 'extensions')
  UNION ALL
  SELECT 'trigger:' || n.nspname || '.' || t.relname || '.' || tr.tgname ||
      ':' || tr.tgenabled::text || ':' || pg_get_triggerdef(tr.oid)
  FROM pg_trigger tr
  JOIN pg_class t ON t.oid = tr.tgrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE NOT tr.tgisinternal
    AND n.nspname IN ('public', 'private', 'extensions')
  UNION ALL
  SELECT 'extension:' || e.extname || ':' || e.extversion || ':' || n.nspname
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  UNION ALL
  SELECT 'comment:' || pg_describe_object(d.classoid, d.objoid, d.objsubid) ||
      ':' || d.description
  FROM pg_description d
  WHERE d.classoid = 'pg_class'::regclass
    AND d.objoid IN (
      SELECT c.oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private', 'extensions')
    )
) AS catalog_items;
