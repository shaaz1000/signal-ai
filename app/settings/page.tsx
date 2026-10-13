import type { Metadata } from 'next';
import { SettingsView } from '@/components/views/library';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <SettingsView platform="web" />;
}
