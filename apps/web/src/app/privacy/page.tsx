import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Pagaska Drive",
  description: "Privacy Policy for Pagaska Drive.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-800">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="mb-8">
          <Link href="/" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            ← Back to Pagaska Drive
          </Link>
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-500">Last updated: August 31, 2026</p>
        </div>

        <div className="space-y-8 text-sm leading-7 text-slate-600">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">1. Overview</h2>
            <p>
              Pagaska Drive is a privacy-focused file management application that provides an interface for
              working with files and folders stored in Google Drive. This Privacy Policy explains what information
              Pagaska Drive processes and how that information is used to operate the service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">2. Information We Process</h2>
            <p>Depending on how you use Pagaska Drive, the service may process:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Workspace or account information required to authenticate you to Pagaska Drive.</li>
              <li>Files, folders, names, metadata, and other Google Drive information needed to provide file-management features.</li>
              <li>Information contained in files only when it is necessary to provide a feature you request, such as uploading, downloading, listing, previewing, renaming, or deleting files.</li>
              <li>Technical information required to maintain security, reliability, and troubleshoot the service.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">3. Google Drive Access</h2>
            <p>
              Pagaska Drive uses Google APIs to provide its Google Drive functionality. Google OAuth credentials used
              by the service are handled server-side and are not intentionally exposed to the browser. Access to Google
              Drive is used only to provide the file-management functionality requested through Pagaska Drive.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">4. How Information Is Used</h2>
            <p>Information is used to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Authenticate users and manage workspaces.</li>
              <li>Display and manage files and folders.</li>
              <li>Process uploads, downloads, previews, and other requested operations.</li>
              <li>Maintain, secure, debug, and improve the service.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">5. Data Sharing</h2>
            <p>
              Pagaska Drive does not sell personal information or Google Drive content. Information may be processed
              by infrastructure providers used to operate the service, such as hosting and API infrastructure, only
              as necessary to provide, secure, and maintain Pagaska Drive.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">6. Data Retention and Deletion</h2>
            <p>
              Pagaska Drive retains information only for as long as reasonably necessary to operate the service and
              maintain security. Files stored in Google Drive remain subject to the Google Drive account and storage
              configuration that controls them. You can request deletion of Pagaska Drive account-related information
              by contacting the operator through the support contact shown in the application&apos;s Google OAuth configuration.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">7. Security</h2>
            <p>
              Reasonable technical measures are used to protect information handled by Pagaska Drive. No internet
              service can guarantee absolute security, so users should also protect their account credentials and
              devices.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">8. Changes to This Policy</h2>
            <p>
              This Privacy Policy may be updated when Pagaska Drive&apos;s functionality, data practices, or legal
              requirements change. The latest version will be published on this page.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">9. Contact</h2>
            <p>
              For questions or privacy requests, use the developer/support contact information provided in the
              Pagaska Drive Google OAuth configuration.
            </p>
          </section>
        </div>

        <footer className="mt-10 border-t border-slate-100 pt-5 text-xs text-slate-400">
          Pagaska Drive
        </footer>
      </article>
    </main>
  );
}
