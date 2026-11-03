/**
 * El motor econométrico contra statsmodels / scipy.
 * Las cifras esperadas salen de scripts/econ/reference.py (datos oficiales del
 * INDEC + datos sintéticos con semilla fija) y están en
 * tests/fixtures/econ/reference.json.
 */
import { describe, expect, it } from "vitest";
import ref from "./fixtures/econ/reference.json";
import real from "./fixtures/econ/indec-real.json";
import { acf, ljungBox, pacf } from "@/lib/econ/acf";
import { fitArima, forecastArima } from "@/lib/econ/arima";
import { correlate } from "@/lib/econ/correlation";
import { hpFilter, seasonalDecompose } from "@/lib/econ/decompose";
import { chi2Sf, fSf, normalInv, tCdf, tInv } from "@/lib/econ/dist";
import { ols } from "@/lib/econ/regression";
import { mean, median, moments, percentile, std, variance } from "@/lib/econ/stats";
import { adf, engleGranger, kpss, mackinnonCrit, mackinnonP, type DetTerm } from "@/lib/econ/unitroot";
import { fevd, fitVar, forecastVar, grangerTest, impulseResponse, selectVarOrder } from "@/lib/econ/var";
import { fitVecm, forecastVecm, johansen } from "@/lib/econ/vecm";

const D = ref.data;
const lipc = real.series.ipc.map(([, v]) => Math.log(v as number));
const close = (a: number, b: number, rel = 1e-6, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));
const closeAll = (a: number[], b: number[], rel = 1e-6, abs = 1e-9) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => close(v, b[i], rel, abs));
};

describe("distribuciones (scipy)", () => {
  it("t, F, χ² y normal", () => {
    for (const [t, df, p] of ref.dist.tcdf) close(tCdf(t, df), p, 1e-9, 1e-12);
    for (const [p, df, q] of ref.dist.tppf) close(tInv(p, df), q, 1e-8);
    for (const [f, a, b, p] of ref.dist.fsf) close(fSf(f, a, b), p, 1e-9, 1e-12);
    for (const [x, k, p] of ref.dist.chi2sf) close(chi2Sf(x, k), p, 1e-9, 1e-12);
    for (const [p, q] of ref.dist.normppf) close(normalInv(p), q, 1e-9);
  });
});

describe("estadística descriptiva (inflación mensual INDEC)", () => {
  const r = ref.describe;
  it("media, mediana, varianza, desvío, percentiles, asimetría y curtosis", () => {
    close(mean(r.x), r.mean, 1e-12);
    close(median(r.x), r.median, 1e-12);
    close(variance(r.x), r.var, 1e-12);
    close(std(r.x), r.std, 1e-12);
    const s = [...r.x].sort((a, b) => a - b);
    close(percentile(s, 10), r.p10, 1e-12);
    close(percentile(s, 90), r.p90, 1e-12);
    const m = moments(r.x);
    close(m.skewness, r.skew, 1e-10);
    close(m.kurtosis, r.kurt, 1e-10);
  });
});

describe("correlaciones (IPC vs. salarios, dif. log.)", () => {
  it("Pearson y Spearman con p-valor", () => {
    const p = correlate(ref.corr.x, ref.corr.y, "pearson");
    close(p.r, ref.corr.pearson[0], 1e-10);
    close(p.p, ref.corr.pearson[1], 1e-7, 1e-14);
    const s = correlate(ref.corr.x, ref.corr.y, "spearman");
    close(s.r, ref.corr.spearman[0], 1e-10);
    close(s.p, ref.corr.spearman[1], 1e-7, 1e-14);
  });
});

describe("MCO (statsmodels OLS)", () => {
  const x = D.x1.map((v, i) => [v, D.x2[i]]);
  const r = ols(D.yreg, x, ["x1", "x2"]);
  const e = ref.ols;
  it("coeficientes, errores, t, p e intervalos", () => {
    closeAll(r.coefficients.map((c) => c.coef), e.params, 1e-9);
    closeAll(r.coefficients.map((c) => c.se), e.bse, 1e-9);
    closeAll(r.coefficients.map((c) => c.t), e.tvalues, 1e-9);
    closeAll(r.coefficients.map((c) => c.p), e.pvalues, 1e-6, 1e-14);
    r.coefficients.forEach((c, i) => {
      close(c.ciLow, e.ci[i][0], 1e-9);
      close(c.ciHigh, e.ci[i][1], 1e-9);
    });
  });
  it("ajuste y criterios", () => {
    close(r.r2, e.r2, 1e-10);
    close(r.adjR2, e.adjr2, 1e-10);
    close(r.fStat!, e.f, 1e-9);
    close(r.fP!, e.fp, 1e-6, 1e-14);
    close(r.llf, e.llf, 1e-10);
    close(r.aic, e.aic, 1e-10);
    close(r.bic, e.bic, 1e-10);
  });
  it("diagnósticos de residuos", () => {
    const d = r.diagnostics;
    close(d.durbinWatson, e.dw, 1e-10);
    close(d.jarqueBera.stat, e.jb[0], 1e-9);
    close(d.jarqueBera.p, e.jb[1], 1e-7);
    close(d.breuschPagan!.lm, e.bp[0], 1e-9);
    close(d.breuschPagan!.p, e.bp[1], 1e-7);
    close(d.ljungBox!.q, e.lb[0], 1e-9);
    close(d.ljungBox!.p, e.lb[1], 1e-7);
  });
  it("errores robustos HC1 y Newey-West (HAC)", () => {
    closeAll(ols(D.yreg, x, ["x1", "x2"], { covType: "HC1" }).coefficients.map((c) => c.se), e.hc1_bse, 1e-9);
    const hac = ols(D.yreg, x, ["x1", "x2"], { covType: "HAC", hacLags: 4 });
    closeAll(hac.coefficients.map((c) => c.se), e.hac_bse, 1e-9);
    close(hac.fStat!, e.hac_f, 1e-8);
  });
});

describe("raíz unitaria y cointegración (statsmodels)", () => {
  const series: Record<string, number[]> = { rw: D.rw, ar: D.ar, lipc };
  it("p-valores y valores críticos de MacKinnon", () => {
    for (const [s, reg, N, p] of ref.unitroot.mackinnonp as [number, DetTerm, number, number][]) close(mackinnonP(s, reg, N), p, 1e-10, 1e-14);
    for (const [reg, N, nobs, crit] of ref.unitroot.mackinnoncrit as [DetTerm, number, number, number[]][]) {
      const c = mackinnonCrit(reg, N, nobs);
      closeAll([c["1%"], c["5%"], c["10%"]], crit, 1e-10);
    }
  });
  it("ADF con selección de rezagos por AIC", () => {
    const cases: [string, number[], DetTerm][] = [
      ["rw_c", series.rw, "c"],
      ["ar_c", series.ar, "c"],
      ["rw_ct", series.rw, "ct"],
      ["ar_n", series.ar, "n"],
      ["lipc_ct", series.lipc, "ct"],
      ["dlipc_c", ref.corr.x, "c"],
    ];
    for (const [key, x, reg] of cases) {
      const e = (ref.unitroot.adf as Record<string, { stat: number; p: number; lag: number; nobs: number; crit: number[] }>)[key];
      const r = adf(x, { regression: reg });
      expect(r.usedLag, key).toBe(e.lag);
      expect(r.nobs, key).toBe(e.nobs);
      close(r.stat, e.stat, 1e-8);
      close(r.p, e.p, 1e-7, 1e-12);
      closeAll([r.crit["1%"], r.crit["5%"], r.crit["10%"]], e.crit, 1e-10);
    }
  });
  it("KPSS con ancho de banda automático", () => {
    const cases: [string, number[], "c" | "ct"][] = [
      ["rw_c", D.rw, "c"],
      ["ar_c", D.ar, "c"],
      ["rw_ct", D.rw, "ct"],
      ["dlipc_c", ref.corr.x, "c"],
    ];
    for (const [key, x, reg] of cases) {
      const e = (ref.unitroot.kpss as Record<string, { stat: number; p: number; lags: number }>)[key];
      const r = kpss(x, { regression: reg });
      expect(r.lags, key).toBe(e.lags);
      close(r.stat, e.stat, 1e-9);
      close(r.p, e.p, 1e-9);
    }
  });
  it("Engle-Granger", () => {
    const r = engleGranger(D.coy, [D.rw]);
    close(r.stat, ref.coint.stat, 1e-8);
    close(r.p, ref.coint.p, 1e-7, 1e-14);
    closeAll([r.crit["1%"], r.crit["5%"], r.crit["10%"]], ref.coint.crit, 1e-10);
  });
});

describe("descomposición y filtros (EMAE original)", () => {
  const y = ref.decompose.emae;
  it("descomposición clásica aditiva y multiplicativa", () => {
    const a = seasonalDecompose(y, 12, "additive");
    closeAll(a.seasonal.slice(0, 12), ref.decompose.add_seasonal, 1e-10);
    close(a.trend[6]!, ref.decompose.add_trend6, 1e-12);
    close(a.resid[10]!, ref.decompose.add_resid10, 1e-9, 1e-12);
    closeAll(seasonalDecompose(y, 12, "multiplicative").seasonal.slice(0, 12), ref.decompose.mul_seasonal, 1e-10);
  });
  it("filtro de Hodrick-Prescott", () => {
    const t = hpFilter(y.map(Math.log), 129600).trend;
    closeAll([t[0], t[50], t[t.length - 1]], ref.decompose.hp_trend, 1e-9);
  });
});

describe("ACF, PACF y Ljung-Box", () => {
  it("coinciden con statsmodels", () => {
    closeAll(acf(D.ar, 10), ref.acf.acf, 1e-10);
    closeAll(pacf(D.ar, 10), ref.acf.pacf, 1e-9);
    const lb = ljungBox(D.ar, 12);
    close(lb.q, ref.acf.lb[0], 1e-9);
    close(lb.p, ref.acf.lb[1], 1e-7, 1e-14);
  });
});

describe("ARIMA por máxima verosimilitud exacta (statsmodels ARIMA)", () => {
  // statsmodels: params = [constante?, AR…, MA…, σ²]
  const check = (key: keyof typeof ref.arima, y: number[]) => {
    const e = ref.arima[key];
    const [p, d, q] = e.order;
    const m = fitArima(y, { p, d, q }, { constant: e.trend !== "n" });
    // Óptimo nunca peor que el de statsmodels y prácticamente igual.
    expect(m.llf).toBeGreaterThanOrEqual(e.llf - 1e-6 * Math.abs(e.llf));
    close(m.llf, e.llf, 1e-5);
    close(m.aic, e.aic, 1e-5);
    const est = [...(m.constant ? [m.mu] : []), ...m.phi, ...m.theta, m.sigma2];
    // Constante con tendencia 't' en statsmodels = deriva por período.
    closeAll(est, e.params, 2e-3, 2e-4);
    const se = m.params.filter((x) => x.se !== null).map((x) => x.se!);
    closeAll(se, e.bse.slice(0, se.length), 2e-3);
    const fc = forecastArima(m, 12);
    closeAll(fc.mean, e.fc_mean, 1e-4, 1e-4);
    closeAll(fc.se, e.fc_se, 2e-3);
  };
  it("ARMA(2,1) con media", () => check("arma21", D.arma));
  it("ARIMA(0,1,1) sin constante", () => check("rw011", D.rw));
  it("AR(1) sin constante", () => check("ar100n", D.ar));
  it("ARIMA(1,1,0) con deriva sobre 100·ln(IPC)", () => check("lipc110", lipc.map((v) => v * 100)));
});

describe("VAR (statsmodels VAR)", () => {
  const e = ref.var;
  const names = ["dlipc", "dlsal", "dlemae"];
  const m = fitVar(e.data, names, 2);
  it("coeficientes, errores estándar y Σu", () => {
    closeAll(m.intercept, e.intercept, 1e-9);
    for (let l = 0; l < 2; l++) closeAll(m.A[l].flat(), e.coefs[l].flat(), 1e-9);
    // stderr de statsmodels: filas = [constante, rezagos…], columnas = ecuaciones
    for (let i = 0; i < 3; i++) {
      close(m.interceptSe[i], e.stderr[0][i], 1e-9);
      for (let l = 0; l < 2; l++) for (let j = 0; j < 3; j++) close(m.ASe[l][i][j], e.stderr[1 + l * 3 + j][i], 1e-9);
    }
    closeAll(m.sigmaU.flat(), e.sigma_u.flat(), 1e-9);
  });
  it("criterios de información, verosimilitud y estabilidad", () => {
    close(m.aic, e.aic, 1e-9);
    close(m.bic, e.bic, 1e-9);
    close(m.hqic, e.hqic, 1e-9);
    close(m.fpe, e.fpe, 1e-9);
    close(m.llf, e.llf, 1e-9);
    close(m.spectralRadius, e.spectral_radius, 1e-6);
    expect(m.stable).toBe(e.stable);
    const sel = selectVarOrder(e.data, names, 6).selected;
    expect(sel.aic).toBe(e.selected.aic);
    expect(sel.bic).toBe(e.selected.bic);
    expect(sel.hqic).toBe(e.selected.hqic);
    expect(sel.fpe).toBe(e.selected.fpe);
  });
  it("impulso-respuesta, descomposición de varianza y pronóstico", () => {
    const irf = impulseResponse(m, 8, { draws: 0 });
    closeAll(irf.irf.flat(2), e.irf_orth.flat(2), 1e-8, 1e-12);
    closeAll(impulseResponse(m, 8, { draws: 0, orthogonalized: false }).irf.flat(2), e.irf.flat(2), 1e-8, 1e-12);
    closeAll(fevd(m, 6).flat(2), e.fevd.flat(2), 1e-8, 1e-12);
    const fc = forecastVar(m, 6, [0.95]);
    closeAll(fc.mean.flat(), e.fc.flat(), 1e-9);
    closeAll(fc.bands[0].lower.flat(), e.fc_lo.flat(), 1e-8);
    closeAll(fc.bands[0].upper.flat(), e.fc_hi.flat(), 1e-8);
  });
  it("causalidad de Granger", () => {
    const g = grangerTest(e.data, names, 2, 1, 0);
    close(g.f, e.granger_f, 1e-9);
    const biv = grangerTest(e.data.map((r) => [r[0], r[1]]), names.slice(0, 2), 2, 1, 0);
    close(biv.f, e.granger_bivar[0], 1e-9);
    close(biv.p, e.granger_bivar[1], 1e-7, 1e-14);
    expect(biv.df2).toBe(e.granger_bivar[2]);
    expect(biv.df1).toBe(e.granger_bivar[3]);
  });
});

describe("Johansen y VECM (statsmodels)", () => {
  const data = D.coy.map((v, i) => [v, D.rw[i]]);
  it("autovalores, traza y máximo autovalor", () => {
    const j = johansen(data, 0, 1);
    closeAll(j.eigenvalues, ref.johansen.eig, 1e-8);
    closeAll(j.trace, ref.johansen.lr1, 1e-8);
    closeAll(j.maxEig, ref.johansen.lr2, 1e-8);
    closeAll(j.traceCrit.flat(), ref.johansen.cvt.flat(), 1e-12);
    // Mismo criterio que statsmodels: primer r con traza < valor crítico al 5 %.
    const expected = ref.johansen.lr1.findIndex((v, i) => v <= ref.johansen.cvt[i][1]);
    expect(j.rank).toBe(expected === -1 ? ref.johansen.lr1.length : expected);
    const j2 = johansen(D.coy.map((v, i) => [v, D.rw[i], D.third[i]]), 0, 2);
    closeAll(j2.eigenvalues, ref.johansen.eig_k2, 1e-8);
    closeAll(j2.trace, ref.johansen.lr1_k2, 1e-8);
  });
  it("VECM: α, β, Γ, constante y pronóstico", () => {
    const m = fitVecm(data, ["coy", "rw"], 1, 1);
    closeAll(m.beta.flat(), ref.vecm.beta.flat(), 1e-8);
    closeAll(m.alpha.flat(), ref.vecm.alpha.flat(), 1e-8);
    closeAll(m.gamma[0].flat(), ref.vecm.gamma.flat(), 1e-8);
    closeAll(m.constant, ref.vecm.det.flat(), 1e-8);
    closeAll(m.sigmaU.flat(), ref.vecm.sigma_u.flat(), 1e-8);
    closeAll(forecastVecm(m, 6).mean.flat(), ref.vecm.forecast.flat(), 1e-8);
  });
});
