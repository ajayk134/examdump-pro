export const metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 text-content-secondary">
      <h1 className="text-3xl font-bold tracking-tight text-content-primary">Privacy policy</h1>
      <p className="text-sm text-content-muted">Last updated: {new Date().getFullYear()}</p>
      <p>We collect the minimum data needed to run your account and improve your study experience.</p>
      <h2 className="text-xl font-semibold text-content-primary">What we store</h2>
      <ul className="list-inside list-disc space-y-1">
        <li>Account details: name, email, hashed password, avatar and preferences.</li>
        <li>Learning data: attempts, answers, bookmarks, notes, stars and analytics.</li>
        <li>Billing records for simulated and future subscriptions.</li>
        <li>Security logs: sign-in events, sessions, IP and user-agent.</li>
      </ul>
      <h2 className="text-xl font-semibold text-content-primary">What we never store</h2>
      <p>Exam questions are served from a private GitHub dataset at request time and are never copied into our application database.</p>
      <h2 className="text-xl font-semibold text-content-primary">Your rights</h2>
      <p>You can export or delete your data at any time from Settings → Data &amp; account.</p>
      <h2 className="text-xl font-semibold text-content-primary">Third parties</h2>
      <p>We use MongoDB Atlas for application data, GitHub for the question dataset, and an optional AI provider for explanations. Secrets are managed with Doppler and never committed to source control.</p>
    </article>
  );
}