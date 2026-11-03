// CPF: só dígitos no banco, com a conta dos dígitos verificadores.

export function soDigitosCpf(v: string) {
  return v.replace(/\D/g, "");
}

export function cpfValido(v: string) {
  const d = soDigitosCpf(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** "123.456.789-09" (aceita o que estiver pela metade, para o campo). */
export function formatarCpf(v: string) {
  const d = soDigitosCpf(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}
