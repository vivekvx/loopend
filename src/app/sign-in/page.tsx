import { AuthPage } from '@/components/auth/auth-page';
export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';
export default function SignInPage() {
  return <AuthPage mode="sign-in" />;
}
