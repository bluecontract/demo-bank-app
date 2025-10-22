export interface UserResult {
  id: string;
  email: string;
  createdAt: string;
  isTest: boolean;
}

export interface AuthResult {
  user: UserResult;
  token: string;
}
