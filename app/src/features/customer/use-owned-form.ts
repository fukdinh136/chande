import {useEffect, useRef, useState} from 'react';
import {useCustomer} from './provider';
import {customerError} from './errors';
import {formFailure, type FormErrors} from './account-form';

export function useOwnedForm() {
  const {session} = useCustomer(), epoch = session.getOwnerEpoch();
  const alive = useRef(true), lock = useRef(false), control = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [errors, setErrors] = useState<FormErrors>({});
  useEffect(() => {alive.current = true; return () => {alive.current = false; control.current?.abort();};}, []);
  const valid = () => alive.current && epoch === session.getOwnerEpoch();
  const run = async <T,>(work: (signal: AbortSignal) => Promise<T>, success: (value: T) => void) => {
    if (lock.current || !valid()) return;
    lock.current = true; const request = new AbortController(); control.current = request; setBusy(true); setMessage(''); setFailed(false); setErrors({});
    const current = () => valid() && !request.signal.aborted && control.current === request;
    try {const result = await work(request.signal); if (current()) success(result);}
    catch (error) {if (current()) {setErrors(formFailure(error)); setFailed(true); setMessage(customerError(error));}}
    finally {if (control.current === request) {lock.current = false; if (current()) setBusy(false);}}
  };
  return {busy, message, failed, errors, setErrors, setMessage, run};
}
