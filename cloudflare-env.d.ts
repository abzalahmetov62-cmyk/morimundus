declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MORIMUNDUS_AUTHOR_EMAIL?: string;
  }
}
