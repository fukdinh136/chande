import { useEffect, useRef, useState } from 'react';

// A background read updates untouched fields only. Dirty fields survive refresh/error.
export function useFormDraft<T extends { [K in keyof T]: string }>(source: T) {
  const [fields, setFields] = useState(source);
  const baseline = useRef(source);
  useEffect(() => {
    const previous = baseline.current;
    baseline.current = source;
    setFields(draft => {
      const next = { ...draft };
      for (const key of Object.keys(source) as (keyof T)[]) if (draft[key] === previous[key]) next[key] = source[key];
      return next;
    });
  }, [source]);
  const reset = (value: T) => { baseline.current = value; setFields(value); };
  const change = (key: keyof T, value: string) => setFields(previous => ({ ...previous, [key]: value }));
  return { fields, change, reset };
}
