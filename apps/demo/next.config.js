//@ts-check

const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  standalone: true,
  // in an Nx/pnpm monorepo, output file tracing otherwise defaults to this
  // app's own directory, silently excluding workspace dependencies (and
  // pnpm-hoisted node_modules) that live outside it from the standalone build
  outputFileTracingRoot: path.join(__dirname, '../..'),
  output: 'standalone',
  // Next.js options go here
  // See: https://nextjs.org/docs/app/api-reference/config/next-config-js
};

module.exports = nextConfig;
