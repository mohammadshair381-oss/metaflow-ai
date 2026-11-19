import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/contexts/auth-provider';
import { createAppRouter } from '@/routes/router';

const router = createAppRouter();

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
