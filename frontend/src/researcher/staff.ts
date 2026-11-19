import { useState } from 'react';

const key = 'sensibilia-staff-name';
const read = () => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

/** The staff member's name, remembered in this browser so it is typed once per day. */
export function useStaffName() {
  const [staff, setStaff] = useState(read);
  return [
    staff,
    (value: string) => {
      setStaff(value);
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable: the name simply is not remembered */
      }
    },
  ] as const;
}
