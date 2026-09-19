import { AuthPage } from '@/components/auth/auth-page';
export const metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';
export default function SignUpPage() {
  return <AuthPage mode="sign-up" />;
}
