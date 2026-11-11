import { redirect } from 'next/navigation';

/** Legacy route: discovery now lives at /exams. */
export default function BrowseRedirect() {
  redirect('/exams');
}
