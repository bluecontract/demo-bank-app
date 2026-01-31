export interface UserResult {
  id: string;
  email: string;
  createdAt: string;
  isTest: boolean;
  marketingEmailsOptIn: boolean;
  merchantId?: string;
}

export interface AuthResult {
  user: UserResult;
  token: string;
}
