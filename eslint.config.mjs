import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "out/**", "public/**", "next-env.d.ts"] },
  ...next,
  {
    // Netlify functions and tool configs are exported as anonymous defaults by convention.
    files: ["netlify/functions/**", "*.config.mjs"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
];

export default config;
