const paths: Record<string, string> = {
  'panel-left':'M3 4h18v16H3z M8 4v16', 'panel-right':'M3 4h18v16H3z M16 4v16',
  book:'M4 4h7c1.5 0 2 1 2 2v15c0-1.5-1.5-2-3-2H4z M13 6c0-1 1-2 2-2h5v15h-4c-1.5 0-3 .5-3 2 M7 8h3 M7 11h3',
  search:'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15 M16 16l5 5', plus:'M12 5v14 M5 12h14',
  file:'M5 3h9l5 5v13H5z M14 3v5h5 M8 12h8 M8 16h6', folder:'M3 6h7l2 2h9v12H3z',
  chevron:'M9 5l7 7-7 7', chevrons:'M8 8l4-4 4 4 M8 16l4 4 4-4',
  close:'M6 6l12 12 M6 18L18 6', moon:'M20 15A8 8 0 0 1 9 4 8 8 0 1 0 20 15', sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19',
  settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  code:'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18', check:'M5 12l4 4L19 6',
  warning:'M12 3L2 21h20z M12 9v5 M12 17h.1', refresh:'M20 7v5h-5 M20 12a8 8 0 1 0-2 6',
  trash:'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7', 'folder-plus':'M3 6h7l2 2h9v12H3z M12 11v6 M9 14h6', home:'M3 11l9-8 9 8 M5 10v11h14V10 M10 21v-7h4v7',
  minimize:'M5 12h14', maximize:'M5 5h14v14H5z',
};
export function Icon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.file} /></svg>; }
