import Link from "next/link";

export default function PublishedLandingPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-5 px-4 text-center">
      <h1 className="text-3xl font-black text-slate-900">Planning 112 publié</h1>
      <p className="text-sm text-slate-600">
        Utilisez le lien secret fourni par le manager (format <code>/p/&lt;token&gt;</code>) pour consulter le planning.
      </p>
      <Link href="/manager" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
        Retour Manager
      </Link>
    </main>
  );
}
