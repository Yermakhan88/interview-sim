import React, { ReactNode } from 'react';

export const metadata = {
  title: 'Interview Simulator',
  description: 'Mic recorder + STT proxy',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
