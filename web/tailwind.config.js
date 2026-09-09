/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        border: 'var(--border)',
        muted: 'var(--muted-bg)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.03), 0 5px 18px rgba(16, 24, 40, 0.025)',
      },
    },
  },
  plugins: [],
};
