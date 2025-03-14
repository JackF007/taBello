
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: JSX.Element;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, isLoading } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex space-x-2">
          <div className="w-3 h-3 bg-tabgenius-500 rounded-full animate-bounce"></div>
          <div className="w-3 h-3 bg-tabgenius-500 rounded-full animate-bounce delay-100"></div>
          <div className="w-3 h-3 bg-tabgenius-500 rounded-full animate-bounce delay-200"></div>
        </div>
      </div>
    );
  }

  // Redirect to login page if not authenticated
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // If authenticated, render the protected content
  return children;
};

export default ProtectedRoute;
