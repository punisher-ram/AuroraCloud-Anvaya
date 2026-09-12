/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        aurora: {
          50: "#fff5f7",
          100: "#ffe4ea",
          200: "#ffc9d5",
          300: "#ff9fb5",
          400: "#f56f91",
          500: "#c94767",
          600: "#9f2949",
          700: "#761b34",
          800: "#501325",
          900: "#2b0a14"
        }
      },
      boxShadow: {
        glow: "0 0 50px rgba(145, 65, 103, .22)"
      }
    }
  },
  plugins: []
};
