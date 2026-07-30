/**
 * The 404 page rendered inside the root layout. This file is a Server
 * Component so it never imports the client context tree — it's
 * deliberately dependency-free to avoid any RSC/Client boundary
 * issues during static prerender of the not-found route.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-sm w-full p-6 text-center">
        <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
        <p className="text-sm text-slate-500 mb-4">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a className="btn-primary inline-flex" href="/">Go to Pagaska Drive</a>
      </div>
    </main>
  );
}
