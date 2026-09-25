export interface User {
  id: number;
  name: string;
  birthDate: string;
  gender: string | null;
  sexualOrientation: string | null;
  nationality: string | null;
  city: string | null;
  profession: string | null;
  createdAt: string;
}

export interface UserWithAge extends User {
  age: number;
}

export interface CreateUser {
  name: string;
  birthDate: string;
  gender?: string;
  sexualOrientation?: string;
  nationality?: string;
  city?: string;
  profession?: string;
}

export function calculateAge(birthDate: string, today = new Date()): number {
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = today.getUTCFullYear() - year;
  const currentMonth = today.getUTCMonth() + 1;
  const currentDay = today.getUTCDate();

  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  return age;
}
