export interface UserResult {
  id: string;
  email: string;
  createdAt: string;
  isTest: boolean;
  marketingEmailsOptIn: boolean;
  merchantId?: string;
  merchantName?: string;
  avatarDataUrl?: string;
}

export interface AuthResult {
  user: UserResult;
  token: string;
}
