import { ASSET_V, layout } from './layout.js';

function accountPage(ctx, profile = false) {
  const body = `
  <section class="page-head"><div class="wrap">
    <ul class="breadcrumb"><li><a href="/">الرئيسية</a></li><li aria-current="page">حسابي</li></ul>
    <h1>حسابك مع لوريت</h1>
    <p>تابع طلبات السفر والعروض والتحديثات في مكان واحد، بأمان وخصوصية.</p>
  </div></section>
  <section class="section-tight">
    <div class="wrap-narrow">
      <div id="clientPortal" class="client-portal" data-initial-view="${profile ? 'profile' : 'bookings'}" aria-live="polite">
        <div class="panel client-loading"><span class="eyebrow">لوريت للسياحة والسفر</span><h2>جارٍ تحميل حسابك…</h2></div>
      </div>
    </div>
  </section>
  <script src="/assets/js/account.js?v=${ASSET_V}" defer></script>`;

  return layout({
    settings: ctx.settings,
    path: '/account',
    nonce: ctx.nonce,
    title: profile ? 'ملفي الشخصي' : 'حسابي وحجوزاتي',
    description: 'سجّل الدخول لمتابعة طلباتك السياحية وتحديث بيانات حسابك بأمان.',
    canonical: `${ctx.baseUrl}/account${profile ? '/profile' : ''}`,
    robots: 'noindex,nofollow',
    body,
  });
}

export const customerAccountPage = (ctx) => accountPage(ctx);
export const customerProfilePage = (ctx) => accountPage(ctx, true);
