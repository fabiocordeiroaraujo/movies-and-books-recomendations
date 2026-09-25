export interface User {
  id: number;
  name: string;
  birthDate: string;
  age: number;
  gender: string | null;
  sexualOrientation: string | null;
  nationality: string | null;
  city: string | null;
  profession: string | null;
  createdAt: string;
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
