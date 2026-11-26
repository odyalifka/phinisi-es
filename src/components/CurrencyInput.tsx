'use client';

import { useEffect, useState } from 'react';

function onlyDigits(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const num = Number(str);
  if (!Number.isNaN(num) && Number.isFinite(num) && /^\d+(\.0+)?$/.test(str)) {
    return String(Math.max(0, Math.round(num)));
  }
  return str.replace(/\D+/g, '');
}

export function formatDotsFromDigits(digits: string): string {
  if (!digits) return '';
  const normalized = digits.replace(/^0+(?=\d)/, '');
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export default function CurrencyInput({
  name,
  defaultValue,
  placeholder,
  required,
  className,
  min,
  max,
}: {
  name: string;
  defaultValue?: number | string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  min?: number | string;
  max?: number | string;
}) {
  const [digits, setDigits] = useState<string>(() => onlyDigits(defaultValue));

  useEffect(() => {
    setDigits(onlyDigits(defaultValue));
  }, [defaultValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D+/g, '');
    let nextDigits = rawDigits.replace(/^0+(?=\d)/, '');

    if (max !== undefined && max !== null && nextDigits !== '') {
      const maxNum = Number(max);
      if (!Number.isNaN(maxNum) && Number(nextDigits) > maxNum) {
        nextDigits = String(Math.max(0, Math.floor(maxNum)));
      }
    }

    if (min !== undefined && min !== null && Number(min) > 0 && nextDigits === '') {
      setDigits('');
      return;
    }

    setDigits(nextDigits);
  };

  return (
    <>
      <input type="hidden" name={name} value={digits} />
      <input
        type="text"
        inputMode="numeric"
        value={formatDotsFromDigits(digits)}
        onChange={handleChange}
        placeholder={placeholder}
        required={required}
        className={className}
      />
    </>
  );
}