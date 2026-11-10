export const metadata = { title: 'Terms of service' };

export default function TermsPage() {
  return (
    <article className="prose-invert mx-auto max-w-3xl space-y-4 text-content-secondary">
      <h1 className="text-3xl font-bold tracking-tight text-content-primary">Terms of service</h1>
      <p className="text-sm text-content-muted">Last updated: {new Date().getFullYear()}</p>
      <p>By creating an account you agree to use ExamDump Pro for lawful personal study purposes only.</p>
      <h2 className="text-xl font-semibold text-content-primary">Study material</h2>
      <p>Questions are provided for educational revision. Certification names and trademarks belong to their respective owners. We are not affiliated with or endorsed by any certification body.</p>
      <h2 className="text-xl font-semibold text-content-primary">Accounts</h2>
      <p>You are responsible for keeping your credentials secure. Do not share your account or attempt to scrape, redistribute or resell the question bank.</p>
      <h2 className="text-xl font-semibold text-content-primary">Subscriptions</h2>
      <p>Premium subscriptions renew for the selected period. You may cancel at any time; access continues until the end of the paid period. Payment processing is currently simulated while integration is completed.</p>
      <h2 className="text-xl font-semibold text-content-primary">Acceptable use</h2>
      <p>Abuse, automated scraping, reverse engineering protections or circumventing usage limits may result in suspension.</p>
    </article>
  );
}