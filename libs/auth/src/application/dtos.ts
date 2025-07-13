export interface UserResult {
  id: string;
  name: string;
  createdAt: string;
  isTest: boolean;
}

export interface AuthResult {
  user: UserResult;
  token: string;
}
