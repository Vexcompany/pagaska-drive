/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef3ff",
          100: "#dbe5ff",
          200: "#b9ccff",
          300: "#8eaaff",
          400: "#5d80ff",
          500: "#3a5dff",
          600: "#2742d6",
          700: "#1f33a8",
          800: "#1b2b80",
          900: "#172461",
        },
      },
    },
  },
  plugins: [],
};
