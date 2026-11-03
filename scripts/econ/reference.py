"""Genera los resultados de referencia (statsmodels / scipy) para los tests del motor econométrico.

Uso (local):
    .venv-econ/bin/python -I scripts/econ/reference.py

Lee tests/fixtures/econ/indec-real.json (datos oficiales) y genera datos
sintéticos con semilla fija. Escribe tests/fixtures/econ/reference.json con
los datos de entrada y los resultados esperados, de modo que los tests de
TypeScript comparan contra las mismas cifras que produce statsmodels.
"""
import json
import pathlib
import warnings

import numpy as np
import pandas as pd
import scipy
import statsmodels
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.diagnostic import acorr_ljungbox, het_breuschpagan
from statsmodels.stats.stattools import durbin_watson, jarque_bera
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.filters.hp_filter import hpfilter
from statsmodels.tsa.seasonal import seasonal_decompose
from statsmodels.tsa.stattools import acf, adfuller, coint, grangercausalitytests, kpss, pacf
from statsmodels.tsa.vector_ar.var_model import VAR
from statsmodels.tsa.vector_ar.vecm import VECM, coint_johansen
from statsmodels.tsa.adfvalues import mackinnoncrit, mackinnonp

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[2]
real = json.loads((ROOT / "tests/fixtures/econ/indec-real.json").read_text())["series"]


def series(name):
    s = pd.Series({d: v for d, v in real[name]})
    s.index = pd.to_datetime(s.index)
    return s.sort_index()


ipc, emae, sal = series("ipc"), series("emae"), series("salarios")
ref = {"versions": {"statsmodels": statsmodels.__version__, "scipy": scipy.__version__, "numpy": np.__version__}}
L = lambda a: [float(x) for x in np.asarray(a).ravel()]
M = lambda a: [[float(x) for x in row] for row in np.asarray(a)]

# ── Datos sintéticos (semilla fija) ─────────────────────────────────────────
rs = np.random.RandomState(20261103)
n = 240
e = rs.standard_normal((n, 3))
rw = np.cumsum(e[:, 0]) + 50                      # caminata aleatoria
ar = np.zeros(n)
for t in range(1, n):
    ar[t] = 0.6 * ar[t - 1] + e[t, 1]             # AR(1) estacionario
coy = 2 + 0.5 * rw + 0.8 * e[:, 2]                # cointegrada con rw
x1 = rs.standard_normal(120) * 2 + 1
x2 = 0.5 * x1 + rs.standard_normal(120)
yreg = 1.5 + 0.8 * x1 - 0.4 * x2 + rs.standard_normal(120) * (1 + 0.3 * np.abs(x1))
arma = np.zeros(300)
eps = rs.standard_normal(300)
for t in range(2, 300):
    arma[t] = 0.5 * arma[t - 1] - 0.2 * arma[t - 2] + eps[t] + 0.4 * eps[t - 1]
arma += 10
ref["data"] = {"rw": L(rw), "ar": L(ar), "coy": L(coy), "x1": L(x1), "x2": L(x2), "yreg": L(yreg), "arma": L(arma)}

# ── Distribuciones ─────────────────────────────────────────────────────────
ref["dist"] = {
    "tcdf": [[t, df, float(stats.t.cdf(t, df))] for t in (-3.1, -0.4, 0, 1.7, 2.5) for df in (3, 12, 60)],
    "tppf": [[p, df, float(stats.t.ppf(p, df))] for p in (0.9, 0.975, 0.995) for df in (5, 30)],
    "fsf": [[f, a, b, float(stats.f.sf(f, a, b))] for f in (0.5, 2.3, 7.0) for a, b in ((2, 30), (5, 100))],
    "chi2sf": [[x, k, float(stats.chi2.sf(x, k))] for x in (0.3, 4.2, 15.0) for k in (1, 2, 10)],
    "normppf": [[p, float(stats.norm.ppf(p))] for p in (0.001, 0.025, 0.3, 0.9, 0.999)],
}

# ── Descriptivas ───────────────────────────────────────────────────────────
inf = (ipc.pct_change() * 100).dropna()
ref["describe"] = {
    "x": L(inf.values),
    "mean": float(inf.mean()), "median": float(inf.median()), "var": float(inf.var()), "std": float(inf.std()),
    "p10": float(np.percentile(inf, 10)), "p90": float(np.percentile(inf, 90)),
    "skew": float(stats.skew(inf)), "kurt": float(stats.kurtosis(inf)),
}

# ── Correlaciones ──────────────────────────────────────────────────────────
dlipc = np.diff(np.log(ipc.values)) * 100
dlsal = np.diff(np.log(sal.values)) * 100
pr, pp = stats.pearsonr(dlipc, dlsal)
sr, sp = stats.spearmanr(dlipc, dlsal)
ref["corr"] = {"x": L(dlipc), "y": L(dlsal), "pearson": [float(pr), float(pp)], "spearman": [float(sr), float(sp)]}

# ── MCO ────────────────────────────────────────────────────────────────────
X = sm.add_constant(np.column_stack([x1, x2]))
res = sm.OLS(yreg, X).fit()
hc1 = sm.OLS(yreg, X).fit(cov_type="HC1")
hac = sm.OLS(yreg, X).fit(cov_type="HAC", cov_kwds={"maxlags": 4})
bp = het_breuschpagan(res.resid, X)
jb = jarque_bera(res.resid)
lb = acorr_ljungbox(res.resid, lags=[10])
ref["ols"] = {
    "params": L(res.params), "bse": L(res.bse), "tvalues": L(res.tvalues), "pvalues": L(res.pvalues),
    "ci": M(res.conf_int(0.05)), "r2": res.rsquared, "adjr2": res.rsquared_adj, "f": res.fvalue, "fp": res.f_pvalue,
    "llf": res.llf, "aic": res.aic, "bic": res.bic, "dw": float(durbin_watson(res.resid)),
    "jb": [float(jb[0]), float(jb[1])], "bp": [float(bp[0]), float(bp[1])],
    "lb": [float(lb["lb_stat"].iloc[0]), float(lb["lb_pvalue"].iloc[0])],
    "hc1_bse": L(hc1.bse), "hac_bse": L(hac.bse), "hac_f": float(hac.fvalue),
}

# ── Raíz unitaria ──────────────────────────────────────────────────────────
def adf_ref(x, reg):
    r = adfuller(x, regression=reg, autolag="AIC")
    return {"stat": r[0], "p": r[1], "lag": r[2], "nobs": r[3], "crit": [r[4]["1%"], r[4]["5%"], r[4]["10%"]], "ic": r[5]}


def kpss_ref(x, reg):
    r = kpss(x, regression=reg, nlags="auto")
    return {"stat": r[0], "p": r[1], "lags": r[2]}


lipc = np.log(ipc.values)
ref["unitroot"] = {
    "adf": {
        "rw_c": adf_ref(rw, "c"), "ar_c": adf_ref(ar, "c"), "rw_ct": adf_ref(rw, "ct"), "ar_n": adf_ref(ar, "n"),
        "lipc_ct": adf_ref(lipc, "ct"), "dlipc_c": adf_ref(dlipc, "c"),
    },
    "kpss": {"rw_c": kpss_ref(rw, "c"), "ar_c": kpss_ref(ar, "c"), "rw_ct": kpss_ref(rw, "ct"), "dlipc_c": kpss_ref(dlipc, "c")},
    "mackinnonp": [[s, reg, N, float(mackinnonp(s, regression=reg, N=N))] for s in (-4.2, -2.9, -1.1, 0.5) for reg in ("n", "c", "ct") for N in (1, 2, 3)],
    "mackinnoncrit": [[reg, N, nobs, L(mackinnoncrit(N=N, regression=reg, nobs=nobs))] for reg in ("c", "ct") for N in (1, 2) for nobs in (50, 239)],
}
cr = coint(coy, rw, trend="c", autolag="aic")
ref["coint"] = {"stat": cr[0], "p": cr[1], "crit": L(cr[2])}

# ── Descomposición y filtros ───────────────────────────────────────────────
emae_v = emae.values
dec_a = seasonal_decompose(emae_v, model="additive", period=12)
dec_m = seasonal_decompose(emae_v, model="multiplicative", period=12)
cycle, trend = hpfilter(np.log(emae_v), lamb=129600)
ref["decompose"] = {
    "emae": L(emae_v),
    "add_seasonal": L(dec_a.seasonal[:12]), "add_trend6": float(dec_a.trend[6]), "add_resid10": float(dec_a.resid[10]),
    "mul_seasonal": L(dec_m.seasonal[:12]),
    "hp_trend": [float(trend[0]), float(trend[50]), float(trend[-1])],
}

# ── ACF / PACF / Ljung-Box ─────────────────────────────────────────────────
ref["acf"] = {"acf": L(acf(ar, nlags=10)), "pacf": L(pacf(ar, nlags=10)), "lb": [float(x) for x in acorr_ljungbox(ar, lags=[12]).iloc[0]]}

# ── ARIMA ──────────────────────────────────────────────────────────────────
def arima_ref(y, order, trend):
    # Errores estándar por hessiana numérica (información observada), como el motor.
    m = ARIMA(y, order=order, trend=trend).fit(cov_type="approx")
    fc = m.get_forecast(12)
    return {
        "order": list(order), "trend": trend, "params": L(m.params), "bse": L(m.bse), "llf": float(m.llf),
        "aic": float(m.aic), "bic": float(m.bic), "fc_mean": L(fc.predicted_mean), "fc_se": L(fc.se_mean),
    }


ref["arima"] = {
    "arma21": arima_ref(arma, (2, 0, 1), "c"),
    "rw011": arima_ref(rw, (0, 1, 1), "n"),
    "lipc110": arima_ref(lipc * 100, (1, 1, 0), "t"),
    "ar100n": arima_ref(ar, (1, 0, 0), "n"),
}

# ── VAR ────────────────────────────────────────────────────────────────────
vdata = np.column_stack([dlipc, dlsal, np.diff(np.log(emae_v)) * 100])
vres = VAR(vdata).fit(2)
sel = VAR(vdata).select_order(6)
irf = vres.irf(8)
fc, lo, hi = vres.forecast_interval(vdata[-2:], 6, alpha=0.05)
gc = vres.test_causality(0, [1], kind="f")
gct = grangercausalitytests(np.column_stack([dlipc, dlsal]), maxlag=[2], verbose=False)[2][0]["ssr_ftest"]
ref["var"] = {
    "data": M(vdata),
    "intercept": L(vres.intercept), "coefs": [M(c) for c in vres.coefs], "stderr": M(vres.stderr),
    "sigma_u": M(vres.sigma_u), "aic": float(vres.aic), "bic": float(vres.bic), "hqic": float(vres.hqic), "fpe": float(vres.fpe),
    "llf": float(vres.llf), "selected": {k: int(v) for k, v in sel.selected_orders.items()},
    "irf_orth": [M(x) for x in irf.orth_irfs], "irf": [M(x) for x in irf.irfs],
    "fevd": [M(x) for x in np.transpose(vres.fevd(6).decomp, (1, 0, 2))],
    "fc": M(fc), "fc_lo": M(lo), "fc_hi": M(hi),
    "granger_f": float(gc.test_statistic), "granger_bivar": [float(gct[0]), float(gct[1]), int(gct[2]), int(gct[3])],
    "stable": bool(vres.is_stable()),
}
# Radio espectral de la compañera
comp = np.zeros((6, 6))
comp[:3, :] = np.hstack(list(vres.coefs))
comp[3:, :3] = np.eye(3)
ref["var"]["spectral_radius"] = float(np.max(np.abs(np.linalg.eigvals(comp))))

# ── Johansen / VECM ────────────────────────────────────────────────────────
jdata = np.column_stack([coy, rw])
jo = coint_johansen(jdata, 0, 1)
third = np.cumsum(rs.standard_normal(n))
jo2 = coint_johansen(np.column_stack([coy, rw, third]), 0, 2)
vecm = VECM(jdata, k_ar_diff=1, coint_rank=1, deterministic="co").fit()
vf = vecm.predict(steps=6)
ref["johansen"] = {
    "eig": L(jo.eig), "lr1": L(jo.lr1), "lr2": L(jo.lr2), "cvt": M(jo.cvt), "cvm": M(jo.cvm),
    "eig_k2": L(jo2.eig), "lr1_k2": L(jo2.lr1),
}
ref["vecm"] = {
    "alpha": M(vecm.alpha), "beta": M(vecm.beta), "gamma": M(vecm.gamma), "det": L(vecm.det_coef),
    "sigma_u": M(vecm.sigma_u), "forecast": M(vf),
}
ref["data"]["third"] = L(third)

dest = ROOT / "tests/fixtures/econ/reference.json"
dest.write_text(json.dumps(ref, separators=(",", ":"), default=float) + "\n")
print("ok", dest.stat().st_size, "bytes")
