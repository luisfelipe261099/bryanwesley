// Importado ANTES de qualquer módulo que leia process.env.
// Em CJS os imports são içados, então a carga precisa morar num módulo próprio.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });
