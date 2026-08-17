import {
  aggregateDaily,
  dayOfMonthProfile,
  escapeHtml,
  filterDaily,
  filterMonthlyDetail,
  monthlyRegionSeries,
  normalizeFilters,
  regionSummary,
  summarize,
  summarizeNamedGroups,
  withEfficiency,
} from './metrics.mjs';

const THEME_STORAGE_KEY = 'elm-meta-theme';
const LANGUAGE_STORAGE_KEY = 'elm-meta-language';
let currentLanguage = document.documentElement.lang === 'vi' ? 'vi' : 'en';
const VI_TRANSLATIONS = {
  'ELM · Meta Growth Development': 'ELM · Diễn biến tăng trưởng Meta',
  'Elmich Meta Ads monthly development dashboard covering spend, directional ROAS, efficiency, account, campaign-group and creative-format trends.': 'Bảng điều khiển diễn biến Meta Ads theo tháng của Elmich, bao gồm chi tiêu, ROAS định hướng, hiệu quả, tài khoản, nhóm chiến dịch và xu hướng định dạng nội dung.',
  'Skip to dashboard': 'Bỏ qua đến bảng điều khiển',
  'Back to Agenthic Lab': 'Quay lại Agenthic Lab',
  'ELM · Meta growth development': 'ELM · Diễn biến tăng trưởng Meta',
  'Follow the monthly curve.': 'Theo dõi biến động tháng.',
  'Then find what moved it.': 'Tìm nguyên nhân.',
  'Spend, directional ROAS, cost per purchase, CVR and AOV across accounts, campaign groups and creative formats.': 'Chi tiêu, ROAS định hướng, chi phí mỗi lượt mua, CVR và AOV theo tài khoản, nhóm chiến dịch và định dạng nội dung.',
  'Bright theme': 'Giao diện sáng',
  'Directional value': 'Giá trị định hướng',
  'Loading audit dataset…': 'Đang tải dữ liệu kiểm toán…',
  'Dashboard filters': 'Bộ lọc bảng điều khiển',
  'Date presets': 'Mốc thời gian nhanh',
  'From': 'Từ',
  'To': 'Đến',
  'Account': 'Tài khoản',
  'Both accounts': 'Cả hai tài khoản',
  'Export filtered CSV': 'Xuất CSV theo bộ lọc',
  '01 / Selected period': '01 / Giai đoạn đã chọn',
  'Selected period': 'Giai đoạn đã chọn',
  'Growth operating view': 'Góc nhìn vận hành tăng trưởng',
  'Read first': 'Đọc trước',
  'Month-to-month movement and account divergence, not a 24-month blended total.': 'Ưu tiên biến động theo tháng và khác biệt giữa các tài khoản, không dùng tổng gộp 24 tháng.',
  'Value caveat': 'Lưu ý về giá trị',
  'ROAS and AOV use the anomaly-adjusted sensitivity series, not booked backend revenue.': 'ROAS và AOV dùng chuỗi độ nhạy đã điều chỉnh bất thường, không phải doanh thu ghi nhận từ hệ thống backend.',
  'Drill next': 'Phân tích tiếp',
  'Campaign and creative views explain delivery mix; value attribution stays directional.': 'Góc nhìn chiến dịch và nội dung giải thích cơ cấu phân phối; phân bổ giá trị vẫn chỉ mang tính định hướng.',
  '02 / Monthly development': '02 / Diễn biến theo tháng',
  'Spend × directional ROAS': 'Chi tiêu × ROAS định hướng',
  'Left-axis metric': 'Chỉ số trục trái',
  'Right-axis metric': 'Chỉ số trục phải',
  'Spend': 'Chi tiêu',
  'Spend · VND': 'Chi tiêu · VND',
  'Directional revenue': 'Doanh thu định hướng',
  'Directional revenue · VND': 'Doanh thu định hướng · VND',
  'Purchases': 'Lượt mua',
  'Reported purchases': 'Lượt mua được báo cáo',
  'Landing-page views': 'Lượt xem trang đích',
  'Directional ROAS': 'ROAS định hướng',
  'Cost / purchase': 'Chi phí / lượt mua',
  'Cost / purchase · VND': 'Chi phí / lượt mua · VND',
  'Purchase CVR': 'CVR mua hàng',
  'Directional AOV': 'AOV định hướng',
  'Directional AOV · VND': 'AOV định hướng · VND',
  'Revenue': 'Doanh thu',
  'Clicks': 'Lượt nhấp',
  'Cost / click': 'Chi phí / lượt nhấp',
  'Cost / click · VND': 'Chi phí / lượt nhấp · VND',
  'Spend share': 'Tỷ trọng chi tiêu',
  'Monthly spend on the left axis and directional modelled ROAS on the right axis': 'Chi tiêu theo tháng ở trục trái và ROAS mô hình định hướng ở trục phải',
  'View monthly growth data': 'Xem dữ liệu tăng trưởng theo tháng',
  'Filtered monthly development': 'Diễn biến theo tháng đã lọc',
  '03 / Efficiency development': '03 / Diễn biến hiệu quả',
  'ROAS, cost, conversion, order value': 'ROAS, chi phí, chuyển đổi và giá trị đơn hàng',
  'Each chart has independent left/right metrics': 'Mỗi biểu đồ có chỉ số trục trái/phải độc lập',
  'Monthly directional ROAS': 'ROAS định hướng theo tháng',
  'Monthly cost per reported purchase': 'Chi phí theo tháng trên mỗi lượt mua được báo cáo',
  'Monthly reported purchases divided by landing page views': 'Lượt mua được báo cáo theo tháng chia cho lượt xem trang đích',
  'Monthly modelled purchase value divided by reported purchases': 'Giá trị mua hàng mô hình theo tháng chia cho lượt mua được báo cáo',
  'Ratio of monthly sums · no averaging of daily ratios': 'Tỷ lệ từ tổng theo tháng · không lấy trung bình các tỷ lệ theo ngày',
  'View efficiency data': 'Xem dữ liệu hiệu quả',
  'Filtered monthly efficiency development': 'Diễn biến hiệu quả theo tháng đã lọc',
  '04 / Account development': '04 / Diễn biến theo tài khoản',
  'Two accounts, two curves': 'Hai tài khoản, hai đường xu hướng',
  'Metric': 'Chỉ số',
  'Selected metric broken down by account': 'Chỉ số đã chọn phân tách theo tài khoản',
  'Monthly account development': 'Diễn biến tài khoản theo tháng',
  '04B / Account scope': '04B / Phạm vi tài khoản',
  'Category split, not account roles': 'Phân tách theo ngành hàng, không phải vai trò tài khoản',
  'Naming taxonomy only': 'Chỉ dựa trên hệ thống đặt tên',
  'Top inferred category scopes by account': 'Các phạm vi ngành hàng suy luận hàng đầu theo tài khoản',
  'Category scope': 'Phạm vi ngành hàng',
  'Spend share in account': 'Tỷ trọng chi tiêu trong tài khoản',
  '04C / Campaign longevity': '04C / Tuổi thọ chiến dịch',
  'Campaigns run in short flights': 'Chiến dịch chạy theo các đợt ngắn',
  'Fixed 24-month audit · both accounts': 'Kiểm toán cố định 24 tháng · cả hai tài khoản',
  'Average active campaign days for both accounts combined and separately': 'Số ngày chiến dịch hoạt động trung bình cho cả hai tài khoản gộp và riêng từng tài khoản',
  'Evidence read': 'Kết luận từ bằng chứng',
  'Short-flight operation: supported': 'Vận hành theo đợt ngắn: có bằng chứng',
  'Campaign longevity evidence': 'Bằng chứng về tuổi thọ chiến dịch',
  'Method: a campaign is active on a day with positive spend or impressions. The primary observational sample includes 1,148 campaigns with a known start inside the audit window. Campaigns marked active or delivering in the final 14 days were excluded. It is not a proven permanent-closure cohort: paused campaigns may resume later. This supports short-flight operation, not that promotions caused the stops or that stopping caused weaker performance.': 'Phương pháp: chiến dịch được tính là hoạt động trong ngày có chi tiêu hoặc lượt hiển thị dương. Mẫu quan sát chính gồm 1.148 chiến dịch có ngày bắt đầu xác định trong kỳ kiểm toán. Các chiến dịch được đánh dấu đang hoạt động hoặc có phân phối trong 14 ngày cuối kỳ đã bị loại trừ. Đây không phải nhóm được chứng minh đã đóng vĩnh viễn: chiến dịch tạm dừng có thể hoạt động lại sau đó. Điều này củng cố nhận định vận hành theo đợt ngắn, không chứng minh khuyến mãi khiến chiến dịch dừng hoặc việc dừng làm hiệu quả yếu đi.',
  'View longevity data and methodology': 'Xem dữ liệu tuổi thọ và phương pháp',
  'Campaign observed active days · 2024-07-01 to 2026-07-12': 'Số ngày hoạt động quan sát được của chiến dịch · 2024-07-01 đến 2026-07-12',
  'Account scope': 'Phạm vi tài khoản',
  'Campaigns': 'Chiến dịch',
  'Average active days': 'Số ngày hoạt động trung bình',
  'Median active days': 'Trung vị số ngày hoạt động',
  '05 / Intra-month dynamics': '05 / Biến động trong tháng',
  'Analyze each month in silo': 'Phân tích riêng từng tháng',
  'Month': 'Tháng',
  'Average spend and directional ROAS by day of month': 'Chi tiêu trung bình và ROAS định hướng theo ngày trong tháng',
  'Daily campaign attribution was not captured in the audit export. The chart can identify recurring account-level timing, but it cannot claim that a specific campaign caused a particular day-level revenue spike.': 'Dữ liệu phân bổ chiến dịch theo ngày không có trong bản xuất kiểm toán. Biểu đồ có thể nhận diện nhịp lặp lại ở cấp tài khoản, nhưng không thể kết luận một chiến dịch cụ thể gây ra đỉnh doanh thu trong một ngày.',
  'View intra-month data': 'Xem dữ liệu trong tháng',
  'Day-of-month development': 'Diễn biến theo ngày trong tháng',
  '05B / Seasonality': '05B / Tính mùa vụ',
  'Q4 demand pull by cell': 'Sức kéo nhu cầu Q4 theo ô',
  'Q4 compared with non-Q4 for the same sanitized cell': 'So sánh Q4 với ngoài Q4 cho cùng một ô đã ẩn danh',
  'Cells that improve more during Q4': 'Các ô cải thiện mạnh hơn trong Q4',
  'Sanitized cell': 'Ô đã ẩn danh',
  'Q4 spend': 'Chi tiêu Q4',
  'Q4 purchases': 'Lượt mua Q4',
  'Non-Q4 CPA': 'CPA ngoài Q4',
  'CPA lift': 'Mức cải thiện CPA',
  'Purchases/month lift': 'Mức tăng lượt mua/tháng',
  '06 / Growth lever board': '06 / Bảng đòn bẩy tăng trưởng',
  'What becomes a South VN operating plan': 'Những gì tạo thành kế hoạch vận hành miền Nam',
  'Sanitized campaign cells · ranked against account medians': 'Các ô chiến dịch đã ẩn danh · xếp hạng so với trung vị tài khoản',
  'Repeatable campaign cells to scale or rebuild': 'Các ô chiến dịch có thể lặp lại để mở rộng hoặc xây dựng lại',
  'Move': 'Hướng xử lý',
  'Months': 'Số tháng',
  'CPA vs median': 'CPA so với trung vị',
  'Clean value leads': 'Số tháng dẫn đầu giá trị sạch',
  'South VN action': 'Hành động cho miền Nam',
  'Cells are parsed from the campaign naming taxonomy into account, intent, level and product/category terms. Raw campaign names, campaign IDs and account IDs are not published in this dashboard.': 'Các ô được phân tách từ hệ thống đặt tên chiến dịch theo tài khoản, mục tiêu, cấp độ và sản phẩm/ngành hàng. Tên chiến dịch gốc, ID chiến dịch và ID tài khoản không được công bố trên bảng điều khiển này.',
  '07 / Campaign taxonomy': '07 / Hệ thống phân loại chiến dịch',
  'Groups visible in the naming system': 'Các nhóm hiển thị trong hệ thống đặt tên',
  'Aggregated labels only · no public campaign names or IDs': 'Chỉ hiển thị nhãn tổng hợp · không công khai tên hoặc ID chiến dịch',
  'Monthly spend by campaign-name group': 'Chi tiêu theo tháng theo nhóm tên chiến dịch',
  'Campaign-group performance for the selected period': 'Hiệu quả nhóm chiến dịch trong giai đoạn đã chọn',
  'Group': 'Nhóm',
  'Clean-month value leads': 'Số tháng sạch dẫn đầu giá trị',
  '07B / Campaign setup': '07B / Thiết lập chiến dịch',
  'Structure visible in setup': 'Cấu trúc hiển thị trong thiết lập',
  'Inferred from naming + ad counts': 'Suy luận từ tên + số lượng quảng cáo',
  'ABO/CBO/Advantage+ and ad-set density breakdown': 'Phân tích ABO/CBO/Advantage+ và mật độ nhóm quảng cáo',
  'Setup group': 'Nhóm thiết lập',
  '08 / Creative format': '08 / Định dạng nội dung',
  'Video × banner × carousel': 'Video × banner × carousel',
  'Format inferred from ad names': 'Định dạng suy luận từ tên quảng cáo',
  'Spend by inferred creative format': 'Chi tiêu theo định dạng nội dung suy luận',
  'Creative-format performance for available ad-level months': 'Hiệu quả định dạng nội dung trong các tháng có dữ liệu cấp quảng cáo',
  'Format': 'Định dạng',
  'This is a format-mix analysis, not a visual creative review. The cached export contains ad names and creative IDs but no thumbnails, video files, hooks or frames. Gia Dụng has 24 months of ad-level coverage; Điện gia dụng has 15 months through 2025-09.': 'Đây là phân tích cơ cấu định dạng, không phải đánh giá trực quan nội dung quảng cáo. Bản xuất lưu đệm có tên quảng cáo và ID nội dung nhưng không có ảnh thu nhỏ, tệp video, hook hoặc khung hình. Gia Dụng có 24 tháng dữ liệu cấp quảng cáo; Điện gia dụng có 15 tháng đến 2025-09.',
  '09 / Regional context': '09 / Bối cảnh khu vực',
  'South as market expansion': 'Miền Nam như một thị trường mở rộng',
  'Regional metric': 'Chỉ số khu vực',
  'Regional spend share, click share and cost per click': 'Tỷ trọng chi tiêu, tỷ trọng lượt nhấp và chi phí mỗi lượt nhấp theo khu vực',
  'Regional monthly cost per click': 'Chi phí mỗi lượt nhấp theo khu vực và theo tháng',
  'South monthly delivery growth': 'Tăng trưởng phân phối theo tháng tại miền Nam',
  'South spend': 'Chi tiêu miền Nam',
  'South spend share': 'Tỷ trọng chi tiêu miền Nam',
  'South clicks': 'Lượt nhấp miền Nam',
  'South CPC': 'CPC miền Nam',
  'Vietnam mapping coverage': 'Độ phủ ánh xạ Việt Nam',
  'Unmatched labels remain separate.': 'Các nhãn chưa khớp được giữ riêng.',
  'Regional event family': 'Nhóm sự kiện khu vực',
  'Meta onsite/platform': 'Meta tại chỗ/nền tảng',
  'Not comparable with the account website-purchase family.': 'Không thể so sánh với nhóm sự kiện mua hàng trên website ở cấp tài khoản.',
  'Conversion interpretation': 'Diễn giải chuyển đổi',
  'Suppressed': 'Không hiển thị',
  'Regional ecommerce claims still require backend geography.': 'Các kết luận TMĐT theo khu vực vẫn cần dữ liệu địa lý từ backend.',
  '10 / Measurement QA': '10 / Kiểm định đo lường',
  'Anomaly work moved to the appendix': 'Phân tích bất thường được chuyển xuống phụ lục',
  'flagged account-days': 'ngày-tài khoản bị gắn cờ',
  'Directional ROAS and AOV above use the volume-preserving sensitivity series. It changes purchase value only; spend, reported purchases, LPV and checkouts remain unchanged.': 'ROAS và AOV định hướng phía trên dùng chuỗi độ nhạy bảo toàn sản lượng. Chuỗi này chỉ thay đổi giá trị mua hàng; chi tiêu, lượt mua được báo cáo, LPV và checkout không đổi.',
  'Open anomaly methodology and flagged rows': 'Mở phương pháp xử lý bất thường và các dòng bị gắn cờ',
  'Flagged account-days': 'Các ngày-tài khoản bị gắn cờ',
  'Date': 'Ngày',
  'Raw value': 'Giá trị gốc',
  'Baseline AOV': 'AOV cơ sở',
  'Modelled value': 'Giá trị mô hình',
  'Excess value': 'Giá trị vượt mức',
  '11 / Decision gate': '11 / Cổng quyết định',
  'What still needs backend proof': 'Những gì vẫn cần bằng chứng từ backend',
  'PowerBI monthly and daily revenue/order reconciliation.': 'Đối soát doanh thu/đơn hàng theo tháng và ngày trong PowerBI.',
  'Campaign-day extraction to attribute intra-month spikes.': 'Trích xuất chiến dịch-ngày để phân bổ các đỉnh biến động trong tháng.',
  'Promotion calendar aligned to campaign starts and stops.': 'Lịch khuyến mãi đối chiếu với ngày bắt đầu và kết thúc chiến dịch.',
  'Creative thumbnails/video assets for a real visual review.': 'Ảnh thu nhỏ/tài sản video để đánh giá trực quan nội dung thực tế.',
  'Margin, cancellations, refunds and South operational constraints.': 'Biên lợi nhuận, hủy đơn, hoàn tiền và các ràng buộc vận hành tại miền Nam.',
  'Source: cached Meta API v22.0 audit export · VND': 'Nguồn: bản xuất kiểm toán Meta API v22.0 lưu đệm · VND',
};
const staticTextNodes = [];
const staticAttributes = [];
const tr = (english) => currentLanguage === 'vi' ? (VI_TRANSLATIONS[english] || english) : english;
const localized = (english, vietnamese) => currentLanguage === 'vi' ? vietnamese : english;

function captureStaticTranslations() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const english = node.nodeValue.trim();
    if (english && VI_TRANSLATIONS[english]) staticTextNodes.push({ node, english });
  }
  document.querySelectorAll('[aria-label]').forEach((node) => {
    const english = node.getAttribute('aria-label');
    if (VI_TRANSLATIONS[english]) staticAttributes.push({ node, attribute: 'aria-label', english });
  });
}

function translateStaticDom() {
  staticTextNodes.forEach(({ node, english }) => {
    const leading = node.nodeValue.match(/^\s*/)[0];
    const trailing = node.nodeValue.match(/\s*$/)[0];
    node.nodeValue = `${leading}${tr(english)}${trailing}`;
  });
  staticAttributes.forEach(({ node, attribute, english }) => node.setAttribute(attribute, tr(english)));
  document.title = tr('ELM · Meta Growth Development');
  document.querySelector('meta[name="description"]')?.setAttribute('content', tr('Elmich Meta Ads monthly development dashboard covering spend, directional ROAS, efficiency, account, campaign-group and creative-format trends.'));
}
const CHART_THEMES = {
  dark: {
    blue: '#5bb7f2', orange: '#ffbc58', green: '#90dfa8', red: '#ff817d', violet: '#a991ff',
    cyan: '#66e3da', pink: '#ec8eff', grid: 'rgba(154, 172, 193, .14)', muted: '#9aacc1', chartBorder: '#111a26',
  },
  light: {
    blue: '#0673b2', orange: '#a45f00', green: '#207d4a', red: '#c6403c', violet: '#684dc7',
    cyan: '#0f7a82', pink: '#ad469d', grid: 'rgba(61, 82, 105, .16)', muted: '#5d7085', chartBorder: '#ffffff',
  },
};
let COLORS = { ...CHART_THEMES.dark };
let PALETTE = [COLORS.blue, COLORS.orange, COLORS.green, COLORS.violet, COLORS.cyan, COLORS.red, COLORS.pink, '#c4d3e6'];
let REGION_COLORS = { South: COLORS.blue, North: COLORS.orange, Mid: COLORS.green };
const state = { data: null, charts: {} };
const CAMPAIGN_LONGEVITY = {
  window: { since: '2024-07-01', until: '2026-07-12' },
  combined: { label: 'Both accounts', campaigns: 1148, meanActiveDays: 17.38850174216028, medianActiveDays: 5 },
  accounts: [
    { label: 'Gia Dụng', campaigns: 547, meanActiveDays: 18.97074954296161, medianActiveDays: 6 },
    { label: 'Điện gia dụng', campaigns: 601, meanActiveDays: 15.948419301164725, medianActiveDays: 5 },
  ],
  shareWithin7Days: 0.6010452961672473,
  shareWithin14Days: 0.7447735191637631,
  shareWithin30Days: 0.8527874564459931,
  startFirstWeek: 0.2691637630662021,
  endLastWeek: 0.18292682926829268,
  uniformCalendarBaseline: 0.22947950620059196,
};

const locale = () => currentLanguage === 'vi' ? 'vi-VN' : 'en-US';
const compact = { format: (value) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 2 }).format(value) };
const integer = { format: (value) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value) };
const decimal = (value, digits) => new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value));
const money = (value) => value == null ? 'N/A' : `${compact.format(value)} VND`;
const fullMoney = (value) => value == null ? 'N/A' : `${integer.format(value)} VND`;
const count = (value) => value == null ? 'N/A' : integer.format(value);
const ratio = (value) => value == null ? 'N/A' : `${decimal(value, 2)}x`;
const percentWithDigits = (value, digits = 1) => value == null ? 'N/A' : `${decimal(Number(value) * 100, digits)}%`;
const percent = (value) => percentWithDigits(value);
const signedPercent = (value) => value == null ? 'N/A' : `${value >= 0 ? '+' : ''}${decimal(Number(value) * 100, 0)}%`;

const METRICS = {
  spend: { label: 'Spend', axis: 'Spend · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.blue },
  modelled_purchase_value: { label: 'Directional revenue', axis: 'Directional revenue · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.violet },
  purchases: { label: 'Purchases', axis: 'Reported purchases', formatter: count, tick: (value) => compact.format(value), color: COLORS.green },
  landing_page_views: { label: 'Landing-page views', axis: 'Landing-page views', formatter: count, tick: (value) => compact.format(value), color: COLORS.cyan },
  modelled_roas: { label: 'Directional ROAS', axis: 'Directional ROAS', formatter: ratio, tick: (value) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(value))}x`, color: COLORS.orange },
  cost_per_purchase: { label: 'Cost / purchase', axis: 'Cost / purchase · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.blue },
  purchase_cvr: { label: 'Purchase CVR', axis: 'Purchase CVR', formatter: percent, tick: (value) => percent(value), color: COLORS.green },
  modelled_aov: { label: 'Directional AOV', axis: 'Directional AOV · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.violet },
  clicks: { label: 'Clicks', axis: 'Clicks', formatter: count, tick: (value) => compact.format(value), color: COLORS.cyan },
  cost_per_click: { label: 'Cost / click', axis: 'Cost / click · VND', formatter: money, tick: (value) => compact.format(value), color: COLORS.violet },
  spend_share: { label: 'Spend share', axis: 'Spend share', formatter: percent, tick: (value) => percent(value), color: COLORS.blue },
};
Object.values(METRICS).forEach((metric) => {
  metric.englishLabel = metric.label;
  metric.englishAxis = metric.axis;
});

function applyMetricLanguage() {
  Object.values(METRICS).forEach((metric) => {
    metric.label = tr(metric.englishLabel);
    metric.axis = tr(metric.englishAxis);
  });
}

function applyLanguage(language, { persist = true, rerender = true } = {}) {
  currentLanguage = language === 'vi' ? 'vi' : 'en';
  document.documentElement.lang = currentLanguage;
  translateStaticDom();
  applyMetricLanguage();
  const toggle = document.getElementById('languageToggle');
  if (toggle) {
    const isVietnamese = currentLanguage === 'vi';
    toggle.setAttribute('aria-label', isVietnamese ? 'Chuyển sang tiếng Anh' : 'Switch to Vietnamese');
    toggle.querySelector('.language-toggle-icon').textContent = isVietnamese ? '🇬🇧' : '🇻🇳';
  }
  document.getElementById('themeToggle')?.setAttribute('aria-label', tr('Bright theme'));
  if (persist) {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
    } catch (_error) {
      // Language switching still works when storage is unavailable.
    }
  }
  if (state.data) {
    document.getElementById('dataStamp').textContent = localized(
      `${state.data.meta.date_range.start} → ${state.data.meta.date_range.end} · generated ${state.data.meta.generated_at.slice(0, 10)}`,
      `${state.data.meta.date_range.start} → ${state.data.meta.date_range.end} · tạo ngày ${state.data.meta.generated_at.slice(0, 10)}`,
    );
    document.getElementById('mappingCoverage').textContent = percentWithDigits(state.data.reconciliation.mapped_spend_coverage, 2);
  }
  if (rerender && state.data) render();
}
const METRIC_COLOR_KEYS = {
  spend: 'blue',
  modelled_purchase_value: 'violet',
  purchases: 'green',
  landing_page_views: 'cyan',
  modelled_roas: 'orange',
  cost_per_purchase: 'blue',
  purchase_cvr: 'green',
  modelled_aov: 'violet',
  clicks: 'cyan',
  cost_per_click: 'violet',
  spend_share: 'blue',
};
const MAIN_KPIS = ['spend', 'modelled_purchase_value', 'purchases', 'landing_page_views', 'cost_per_purchase', 'purchase_cvr', 'modelled_aov', 'modelled_roas'];

function applyChartTheme(theme) {
  COLORS = { ...CHART_THEMES[theme] };
  PALETTE = [COLORS.blue, COLORS.orange, COLORS.green, COLORS.violet, COLORS.cyan, COLORS.red, COLORS.pink, theme === 'light' ? '#8294a8' : '#c4d3e6'];
  REGION_COLORS = { South: COLORS.blue, North: COLORS.orange, Mid: COLORS.green };
  Object.entries(METRIC_COLOR_KEYS).forEach(([metric, color]) => { METRICS[metric].color = COLORS[color]; });
  if (window.Chart) window.Chart.defaults.color = COLORS.muted;
}

function applyTheme(theme, { persist = true, rerender = true } = {}) {
  const selected = theme === 'light' ? 'light' : 'dark';
  const isLight = selected === 'light';
  document.documentElement.dataset.theme = selected;
  document.getElementById('themeColor')?.setAttribute('content', isLight ? '#f4f7fb' : '#091019');
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(isLight));
    toggle.setAttribute('aria-label', tr('Bright theme'));
    toggle.querySelector('.theme-toggle-icon').textContent = isLight ? '☀' : '☾';
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, selected);
    } catch (_error) {
      // Theme switching still works when storage is unavailable.
    }
  }
  applyChartTheme(selected);
  if (rerender && state.data) render();
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function replaceChart(name, canvas, config) {
  state.charts[name]?.destroy();
  state.charts[name] = new window.Chart(canvas, config);
}

function baseScales() {
  return {
    x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkipPadding: 24 } },
    y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.muted } },
  };
}

function sortLegendByAxis(a, b, data) {
  const rightAxes = new Set(['secondary', 'cost']);
  const rank = item => rightAxes.has(data.datasets[item.datasetIndex]?.yAxisID) ? 1 : 0;
  return rank(a) - rank(b);
}

function options(tooltip, scales = baseScales(), mode = 'index') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 },
    interaction: { intersect: false, mode },
    plugins: {
      legend: { labels: { color: COLORS.muted, usePointStyle: true, boxWidth: 8, padding: 16, sort: sortLegendByAxis } },
      tooltip: { callbacks: { label: tooltip } },
    },
    scales,
  };
}

function dualAxisOptions(primaryMetric = 'spend', primaryAxisLabel = null, secondaryMetric = 'modelled_roas', secondaryAxisLabel = null) {
  const primary = METRICS[primaryMetric] || METRICS.spend;
  const secondary = METRICS[secondaryMetric] || METRICS.modelled_roas;
  return options(
    (item) => item.dataset.yAxisID === 'secondary' ? `${item.dataset.label}: ${secondary.formatter(item.raw)}` : `${item.dataset.label}: ${primary.formatter(item.raw)}`,
    {
      x: { grid: { display: false }, ticks: { color: COLORS.muted, maxRotation: 0, autoSkipPadding: 20 } },
      primary: { beginAtZero: true, position: 'left', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: primary.tick }, title: { display: true, text: primaryAxisLabel || primary.axis, color: COLORS.muted } },
      secondary: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: secondary.color, callback: secondary.tick }, title: { display: true, text: secondaryAxisLabel || secondary.axis, color: secondary.color } },
    },
  );
}

function renderKpiTableBody(series) {
  return series.map((row) => `<tr><td>${escapeHtml(row.label)}</td>${MAIN_KPIS.map((key) => `<td>${escapeHtml(METRICS[key].formatter(row[key]))}</td>`).join('')}</tr>`).join('');
}

function renderKpiTableHead(label = 'Month') {
  return `<tr><th>${escapeHtml(tr(label))}</th>${MAIN_KPIS.map((key) => `<th>${escapeHtml(METRICS[key].label)}</th>`).join('')}</tr>`;
}

function getFilters() {
  const account = document.getElementById('accountFilter').value;
  return {
    from: document.getElementById('dateFrom').value,
    to: document.getElementById('dateTo').value,
    account,
    accounts: account === 'all' ? [] : [account],
    grain: 'month',
  };
}

function normalizeCurrentFilters() {
  const normalized = normalizeFilters(getFilters(), state.data.meta.date_range, ['all', 'Gia Dụng', 'Điện gia dụng']);
  document.getElementById('dateFrom').value = normalized.from;
  document.getElementById('dateTo').value = normalized.to;
  document.getElementById('accountFilter').value = normalized.account;
  return normalized;
}

function presetRanges() {
  return {
    '6m': { start: '2026-01-01', end: '2026-06-30' },
    '12m': { start: '2025-07-01', end: '2026-06-30' },
    '24m': state.data.meta.date_range,
    2025: { start: '2025-01-01', end: '2025-12-31' },
  };
}

function updateUrl(filters) {
  const params = new URLSearchParams();
  if (filters.from !== '2025-07-01') params.set('from', filters.from);
  if (filters.to !== state.data.meta.date_range.end) params.set('to', filters.to);
  if (filters.accounts.length) params.set('account', filters.accounts[0]);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
}

function syncPreset(filters) {
  const ranges = presetRanges();
  document.querySelectorAll('.preset').forEach((button) => {
    const range = ranges[button.dataset.preset];
    button.classList.toggle('active', filters.from === range.start && filters.to === range.end);
  });
}

function monthly(rows) {
  return aggregateDaily(rows, 'month').map(withEfficiency);
}

function renderKpis(rows, filters) {
  const summary = summarize(rows);
  const cards = [
    [tr('Spend'), money(summary.spend), localized('Meta delivery', 'Phân phối trên Meta')],
    [tr('Directional ROAS'), ratio(summary.modelled_roas), localized('Sensitivity value ÷ spend', 'Giá trị độ nhạy ÷ chi tiêu')],
    [tr('Cost / purchase'), money(summary.cost_per_purchase), localized('CPA proxy · reported purchase', 'Chỉ số thay thế CPA · lượt mua được báo cáo')],
    [tr('Purchase CVR'), percent(summary.purchase_cvr), localized('Purchases ÷ landing-page views', 'Lượt mua ÷ lượt xem trang đích')],
    [tr('Directional AOV'), money(summary.modelled_aov), localized('Sensitivity value ÷ purchases', 'Giá trị độ nhạy ÷ lượt mua')],
    [tr('Purchases'), count(summary.purchases), localized('Meta-reported website family', 'Nhóm sự kiện website do Meta báo cáo')],
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  document.getElementById('selectionSummary').textContent = `${filters.from} → ${filters.to} · ${filters.account === 'all' ? localized('both accounts', 'cả hai tài khoản') : filters.account}`;
}

function renderGrowth(rows) {
  const series = monthly(rows);
  const metricKey = document.getElementById('growthMetric').value;
  const rightMetricKey = document.getElementById('growthMetricRight').value;
  const metric = METRICS[metricKey];
  const rightMetric = METRICS[rightMetricKey];
  document.getElementById('growthTitle').textContent = `${metric.label} × ${rightMetric.label}`;
  const canvas = document.getElementById('growthChart');
  canvas.setAttribute('aria-label', localized(`Monthly ${metric.label} on the left axis and ${rightMetric.label} on the right axis`, `${metric.label} theo tháng ở trục trái và ${rightMetric.label} ở trục phải`));
  replaceChart('growth', document.getElementById('growthChart'), {
    data: { labels: series.map((row) => row.label), datasets: [
      { type: 'bar', label: metric.label, data: series.map((row) => row[metricKey]), backgroundColor: `${metric.color}99`, borderColor: metric.color, borderWidth: 1, borderRadius: 6, yAxisID: 'primary' },
      { type: 'line', label: rightMetric.label, data: series.map((row) => row[rightMetricKey]), borderColor: rightMetric.color, backgroundColor: rightMetric.color, borderWidth: 3, pointRadius: 4, tension: .22, yAxisID: 'secondary' },
    ] },
    options: dualAxisOptions(metricKey, null, rightMetricKey),
  });
  const first = series[0];
  const last = series.at(-1);
  const change = first?.[metricKey] ? (last[metricKey] - first[metricKey]) / first[metricKey] : null;
  document.getElementById('growthInsight').textContent = first && last
    ? localized(
      `${first.label} → ${last.label}: ${metric.label.toLowerCase()} moved ${signedPercent(change)} from ${metric.formatter(first[metricKey])} to ${metric.formatter(last[metricKey])}, while ${rightMetric.label.toLowerCase()} moved from ${rightMetric.formatter(first[rightMetricKey])} to ${rightMetric.formatter(last[rightMetricKey])}.`,
      `${first.label} → ${last.label}: ${metric.label.toLowerCase()} thay đổi ${signedPercent(change)}, từ ${metric.formatter(first[metricKey])} lên ${metric.formatter(last[metricKey])}; ${rightMetric.label.toLowerCase()} thay đổi từ ${rightMetric.formatter(first[rightMetricKey])} thành ${rightMetric.formatter(last[rightMetricKey])}.`,
    )
    : localized('No monthly rows match the selected filters.', 'Không có dữ liệu tháng phù hợp với bộ lọc đã chọn.');
  document.getElementById('growthTableHead').innerHTML = renderKpiTableHead();
  document.getElementById('growthTableCaption').textContent = localized('Filtered monthly KPI development', 'Diễn biến KPI theo tháng đã lọc');
  document.getElementById('growthTable').innerHTML = renderKpiTableBody(series);
  return series;
}

function renderMetricPair(name, canvasId, series, leftKey, rightKey) {
  const left = METRICS[leftKey];
  const right = METRICS[rightKey];
  replaceChart(name, document.getElementById(canvasId), {
    data: { labels: series.map((row) => row.label), datasets: [
      { type: 'bar', label: left.label, data: series.map((row) => row[leftKey]), backgroundColor: `${left.color}88`, borderRadius: 4, yAxisID: 'primary' },
      { type: 'line', label: right.label, data: series.map((row) => row[rightKey]), borderColor: right.color, backgroundColor: right.color, pointRadius: 3, borderWidth: 2.5, tension: .22, yAxisID: 'secondary' },
    ] },
    options: dualAxisOptions(leftKey, null, rightKey),
  });
}

function renderEfficiency(series) {
  const cards = {
    modelled_roas: { article: document.querySelector('[data-efficiency-card="modelled_roas"]'), chart: 'roas', canvas: 'roasChart' },
    cost_per_purchase: { article: document.querySelector('[data-efficiency-card="cost_per_purchase"]'), chart: 'cpp', canvas: 'cppChart' },
    purchase_cvr: { article: document.querySelector('[data-efficiency-card="purchase_cvr"]'), chart: 'cvr', canvas: 'cvrChart' },
    modelled_aov: { article: document.querySelector('[data-efficiency-card="modelled_aov"]'), chart: 'aov', canvas: 'aovChart' },
  };
  Object.entries(cards).forEach(([key, target]) => {
    const leftKey = document.getElementById(`${key}Left`).value;
    const rightKey = document.getElementById(`${key}Right`).value;
    const left = METRICS[leftKey];
    const right = METRICS[rightKey];
    target.article.querySelector('h3').textContent = `${left.label} × ${right.label}`;
    target.article.querySelector('canvas').setAttribute('aria-label', localized(`Monthly ${left.label} and ${right.label}`, `${left.label} và ${right.label} theo tháng`));
    renderMetricPair(target.chart, target.canvas, series, leftKey, rightKey);
  });
  document.getElementById('efficiencyTableHead').innerHTML = renderKpiTableHead();
  document.getElementById('efficiencyTable').innerHTML = renderKpiTableBody(series);
}

function accountSeries(rows, account) {
  return monthly(rows.filter((row) => row.account === account));
}

function renderAccounts(rows, filters) {
  const metricKey = document.getElementById('accountMetric').value;
  const metric = METRICS[metricKey];
  const visibleAccounts = filters.accounts.length ? filters.accounts : ['Gia Dụng', 'Điện gia dụng'];
  const labels = [...new Set(monthly(rows).map((row) => row.label))].sort();
  const accountRows = Object.fromEntries(visibleAccounts.map((account) => [account, accountSeries(rows, account)]));
  replaceChart('accountCompare', document.getElementById('accountCompareChart'), {
    type: 'line',
    data: { labels, datasets: visibleAccounts.map((account, index) => ({
      label: account,
      data: labels.map((label) => accountRows[account].find((row) => row.label === label)?.[metricKey] ?? null),
      borderColor: PALETTE[index],
      backgroundColor: PALETTE[index],
      pointRadius: 3,
      borderWidth: 3,
      tension: .2,
      spanGaps: true,
    })) },
    options: options((item) => `${item.dataset.label}: ${metric.formatter(item.raw)}`, { x: baseScales().x, y: { ...baseScales().y, ticks: { color: COLORS.muted, callback: metric.tick }, title: { display: true, text: metric.axis, color: COLORS.muted } } }),
  });
  const home = accountRows['Gia Dụng'] || [];
  const electric = accountRows['Điện gia dụng'] || [];
  const records = [...home.map((row) => ({ ...row, account: 'Gia Dụng' })), ...electric.map((row) => ({ ...row, account: 'Điện gia dụng' }))].sort((a, b) => a.label.localeCompare(b.label) || a.account.localeCompare(b.account));
  document.getElementById('accountTableHead').innerHTML = `<tr><th>${tr('Month')}</th><th>${tr('Account')}</th>${MAIN_KPIS.map((key) => `<th>${escapeHtml(METRICS[key].label)}</th>`).join('')}</tr>`;
  document.getElementById('accountTableCaption').textContent = localized(`Monthly account ${metric.label} and directional ROAS`, `${metric.label} và ROAS định hướng theo tháng theo tài khoản`);
  document.getElementById('accountMonthTable').innerHTML = records.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.account)}</td>${MAIN_KPIS.map((key) => `<td>${escapeHtml(METRICS[key].formatter(row[key]))}</td>`).join('')}</tr>`).join('');
}

function renderDayOfMonth(rows) {
  const metricKey = document.getElementById('intramonthMetric').value;
  const rightMetricKey = document.getElementById('intramonthMetricRight').value;
  const metric = METRICS[metricKey];
  const rightMetric = METRICS[rightMetricKey];
  const monthSelect = document.getElementById('intramonthMonth');
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort();
  const current = months.includes(monthSelect.value) ? monthSelect.value : months.at(-1);
  monthSelect.innerHTML = months.map((month) => `<option value="${escapeHtml(month)}"${month === current ? ' selected' : ''}>${escapeHtml(month)}</option>`).join('');
  const dailyRows = rows.filter((row) => row.date.startsWith(current || '')).sort((a, b) => a.date.localeCompare(b.date)).map(withEfficiency);
  const profile = dailyRows.map((row) => ({ ...row, label: String(Number(row.date.slice(8, 10))) }));
  const canvas = document.getElementById('dayOfMonthChart');
  canvas.setAttribute('aria-label', localized(`${metric.label} and ${rightMetric.label} by day inside ${current}`, `${metric.label} và ${rightMetric.label} theo ngày trong ${current}`));
  replaceChart('dayOfMonth', document.getElementById('dayOfMonthChart'), {
    data: { labels: profile.map((row) => row.label), datasets: [
      { type: 'bar', label: metric.label, data: profile.map((row) => row[metricKey]), backgroundColor: `${metric.color}88`, borderRadius: 4, yAxisID: 'primary' },
      { type: 'line', label: rightMetric.label, data: profile.map((row) => row[rightMetricKey]), borderColor: rightMetric.color, backgroundColor: rightMetric.color, borderWidth: 2.5, pointRadius: 3, tension: .18, yAxisID: 'secondary' },
    ] },
    options: dualAxisOptions(metricKey, null, rightMetricKey),
  });
  const peak = profile.reduce((best, row) => !best || Number(row[metricKey] || 0) > Number(best[metricKey] || 0) ? row : best, null);
  const campaignDays = profile.filter((row) => Number(row.label) === Number((current || '00-00').slice(5, 7)) || ['15', '20', '25'].includes(row.label)).map((row) => row.label).join(', ');
  document.getElementById('dayOfMonthInsight').textContent = peak
    ? localized(
      `${current}: day ${peak.label} has the strongest ${metric.label.toLowerCase()} at ${metric.formatter(peak[metricKey])}. Watch double-day and payday-style offer dates (${campaignDays || 'none in selected month'}), but attribute merit only after campaign-day extraction.`,
      `${current}: ngày ${peak.label} có ${metric.label.toLowerCase()} cao nhất, đạt ${metric.formatter(peak[metricKey])}. Theo dõi các ngày đôi và ngày ưu đãi theo kỳ lương (${campaignDays || 'không có trong tháng đã chọn'}), nhưng chỉ phân bổ nguyên nhân sau khi trích xuất dữ liệu chiến dịch-ngày.`,
    )
    : localized('No daily rows match the selected month.', 'Không có dữ liệu ngày phù hợp với tháng đã chọn.');
  document.getElementById('intramonthTableHead').innerHTML = renderKpiTableHead(localized('Day', 'Ngày'));
  document.getElementById('intramonthTableCaption').textContent = localized(`${current} daily KPI development`, `Diễn biến KPI hằng ngày trong ${current}`);
  document.getElementById('intramonthTable').innerHTML = profile.map((row) => `<tr><td>${escapeHtml(row.label)}</td>${MAIN_KPIS.map((key) => `<td>${escapeHtml(METRICS[key].formatter(row[key]))}</td>`).join('')}</tr>`).join('');
}

function summarizeCampaignCells(rows) {
  const grouped = new Map();
  const cleanMonthLeaders = new Map();
  rows.forEach((row) => {
    const key = `${row.account}|${row.cell}`;
    if (!grouped.has(key)) grouped.set(key, {
      account: row.account,
      cell: row.cell,
      months: new Set(),
      spend: 0,
      purchases: 0,
      landing_page_views: 0,
      checkouts: 0,
      raw_purchase_value: 0,
      clean_value_months_won: 0,
    });
    const target = grouped.get(key);
    target.months.add(row.month);
    ['spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value'].forEach((metric) => { target[metric] += Number(row[metric] || 0); });
    if (row.value_reliable) {
      const monthKey = `${row.account}|${row.month}`;
      const value = Number(row.raw_purchase_value || 0);
      if (!cleanMonthLeaders.has(monthKey) || value > cleanMonthLeaders.get(monthKey).value) {
        cleanMonthLeaders.set(monthKey, { key, value });
      }
    }
  });
  cleanMonthLeaders.forEach(({ key }) => {
    if (grouped.has(key)) grouped.get(key).clean_value_months_won += 1;
  });
  return [...grouped.values()].map((row) => ({
    ...row,
    months_active: row.months.size,
    cost_per_purchase: row.purchases ? row.spend / row.purchases : null,
    purchase_cvr: row.landing_page_views ? row.purchases / row.landing_page_views : null,
    raw_roas: row.spend ? row.raw_purchase_value / row.spend : null,
  })).sort((a, b) => b.spend - a.spend);
}

function benchmarkCells(rows) {
  const accounts = [...new Set(rows.map((row) => row.account))];
  return Object.fromEntries(accounts.map((account) => {
    const scoped = rows.filter((row) => row.account === account);
    return [account, {
      median_cpa: median(scoped.filter((row) => row.purchases >= 30).map((row) => row.cost_per_purchase)),
      median_cvr: median(scoped.filter((row) => row.landing_page_views >= 500).map((row) => row.purchase_cvr)),
    }];
  }));
}

function leverAction(type, cell) {
  const lower = cell.toLowerCase();
  if (type === 'scale') {
    if (lower.includes('retargeting')) return localized('Turn into a clean South retargeting pool with offer sequencing and frequency control.', 'Chuyển thành tệp retargeting sạch cho miền Nam, có chuỗi ưu đãi và kiểm soát tần suất.');
    if (lower.includes('prospecting')) return localized('Build a South-only prospecting test with isolated budget, matching product supply and local proof angles.', 'Xây dựng thử nghiệm prospecting riêng cho miền Nam với ngân sách tách biệt, nguồn hàng phù hợp và thông điệp bằng chứng địa phương.');
    if (lower.includes('asc')) return localized('Clone into a South-contained ASC test and protect it from blended national budget drift.', 'Nhân bản thành thử nghiệm ASC giới hạn tại miền Nam và tránh ngân sách bị trộn với toàn quốc.');
    return localized('Protect the pattern, isolate South delivery, then validate product/category margin before scaling.', 'Bảo vệ mô hình, tách phân phối miền Nam, sau đó xác thực biên lợi nhuận sản phẩm/ngành hàng trước khi mở rộng.');
  }
  if (lower.includes('retargeting')) return localized('Rebuild audience recency, exclusions and offer ladder before allowing more South retargeting spend.', 'Xây dựng lại độ mới của tệp, loại trừ và thang ưu đãi trước khi tăng thêm chi tiêu retargeting miền Nam.');
  if (lower.includes('prospecting')) return localized('Audit audience breadth, creative promise and landing path; cap spend until CPA/CVR recovers.', 'Kiểm tra độ rộng tệp, lời hứa nội dung và hành trình trang đích; giới hạn chi tiêu cho đến khi CPA/CVR phục hồi.');
  return localized('Treat as a budget leak: inspect offer, category fit, audience intent and conversion path.', 'Xem như điểm rò rỉ ngân sách: kiểm tra ưu đãi, độ phù hợp ngành hàng, ý định tệp và hành trình chuyển đổi.');
}

function renderLeverBoard(filters) {
  const rows = filterMonthlyDetail(state.data.campaign_cells || [], filters);
  const summaries = summarizeCampaignCells(rows).filter((row) => row.months_active >= 2 && row.spend >= 50_000_000 && row.purchases >= 40);
  const benchmarks = benchmarkCells(summaries);
  const enriched = summaries.map((row) => {
    const bench = benchmarks[row.account] || {};
    const cpaLift = bench.median_cpa && row.cost_per_purchase ? (bench.median_cpa - row.cost_per_purchase) / bench.median_cpa : null;
    const cvrLift = bench.median_cvr && row.purchase_cvr ? (row.purchase_cvr - bench.median_cvr) / bench.median_cvr : null;
    return { ...row, cpaLift, cvrLift };
  });
  const scale = enriched
    .filter((row) => row.cpaLift > .12)
    .sort((a, b) => (b.cpaLift * 60 + b.clean_value_months_won * 6 + b.months_active) - (a.cpaLift * 60 + a.clean_value_months_won * 6 + a.months_active))
    .slice(0, 5);
  const rebuild = enriched
    .filter((row) => row.cpaLift < -.25 && row.spend >= 80_000_000)
    .sort((a, b) => (a.cpaLift * 70 - b.spend / 100_000_000) - (b.cpaLift * 70 - a.spend / 100_000_000))
    .slice(0, 5);
  const cards = [
    [localized('Scale candidates', 'Ứng viên mở rộng'), scale.length, scale[0] ? localized(`${scale[0].cell} at ${money(scale[0].cost_per_purchase)} CPA`, `${scale[0].cell} với CPA ${money(scale[0].cost_per_purchase)}`) : localized('No strong repeatable candidate in selection', 'Không có ứng viên lặp lại đủ mạnh trong lựa chọn'), 'signal-fact'],
    [localized('Rebuild / waste cells', 'Ô cần xây dựng lại / lãng phí'), rebuild.length, rebuild[0] ? localized(`${rebuild[0].cell} at ${money(rebuild[0].cost_per_purchase)} CPA`, `${rebuild[0].cell} với CPA ${money(rebuild[0].cost_per_purchase)}`) : localized('No major repeated waste cell in selection', 'Không có ô lãng phí lặp lại đáng kể trong lựa chọn'), 'signal-hold'],
    [localized('Offer bridge', 'Cầu nối đề xuất'), scale.length + rebuild.length, localized('Use these cells to define South-only campaign structure, product focus and budget rules.', 'Dùng các ô này để xác định cấu trúc chiến dịch riêng cho miền Nam, trọng tâm sản phẩm và quy tắc ngân sách.'), 'signal-test'],
  ];
  document.getElementById('leverCards').innerHTML = cards.map(([label, value, note, className]) => `<article><span class="${className}">${label}</span><strong>${count(value)}</strong><p>${escapeHtml(note)}</p></article>`).join('');
  const tableRows = [
    ...scale.map((row) => ({ ...row, type: 'Scale' })),
    ...rebuild.map((row) => ({ ...row, type: 'Rebuild' })),
  ];
  document.getElementById('leverTable').innerHTML = tableRows.map((row) => `<tr><td><span class="${row.type === 'Scale' ? 'cell-good' : 'cell-hold'}">${localized(row.type, row.type === 'Scale' ? 'Mở rộng' : 'Xây dựng lại')}</span></td><td>${escapeHtml(row.cell)}</td><td>${escapeHtml(count(row.months_active))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(signedPercent(row.cpaLift))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td><td>${escapeHtml(count(row.clean_value_months_won))}</td><td>${escapeHtml(leverAction(row.type.toLowerCase(), row.cell))}</td></tr>`).join('');
  document.getElementById('leverInsight').textContent = tableRows.length
    ? localized('This is the service-offer bridge: preserve the scale cells, rebuild the waste cells, and run the South Vietnam execution around isolated budget, local proof, product availability and clean measurement.', 'Đây là cầu nối sang đề xuất dịch vụ: giữ các ô có thể mở rộng, xây dựng lại các ô lãng phí và vận hành miền Nam bằng ngân sách tách biệt, bằng chứng địa phương, nguồn hàng sẵn có và đo lường sạch.')
    : localized('No repeatable campaign cells meet the selected thresholds. Widen the date range or use the campaign taxonomy view below.', 'Không có ô chiến dịch lặp lại nào đạt ngưỡng đã chọn. Hãy mở rộng khoảng thời gian hoặc dùng góc nhìn phân loại chiến dịch bên dưới.');
}

function renderCampaigns(filters) {
  const rows = filterMonthlyDetail(state.data.campaign_groups, filters);
  const summary = summarizeNamedGroups(rows);
  const months = [...new Set(rows.map((row) => row.month))].sort();
  const groups = summary.map((row) => row.group);
  replaceChart('campaignMix', document.getElementById('campaignMixChart'), {
    type: 'bar',
    data: { labels: months, datasets: groups.map((group, index) => ({ label: group, data: months.map((month) => rows.filter((row) => row.month === month && row.group === group).reduce((sum, row) => sum + Number(row.spend || 0), 0)), backgroundColor: `${PALETTE[index % PALETTE.length]}bb`, borderRadius: 3 })) },
    options: options((item) => `${item.dataset.label}: ${money(item.raw)}`, { x: { ...baseScales().x, stacked: true }, y: { ...baseScales().y, stacked: true, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) } } }),
  });
  document.getElementById('campaignTable').innerHTML = summary.map((row) => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td><td>${escapeHtml(count(row.clean_value_months_won))}</td></tr>`).join('');
  const leader = summary[0];
  const valueLeader = [...summary].sort((a, b) => b.clean_value_months_won - a.clean_value_months_won)[0];
  document.getElementById('campaignInsight').textContent = leader
    ? localized(
      `${leader.group} is the largest spend group at ${percent(leader.spend_share)} of selected campaign-level spend. ${valueLeader.group} leads raw tracked value in ${valueLeader.clean_value_months_won} clean account-months, but campaign value remains directional because the anomaly model is only available at account-day grain.`,
      `${leader.group} là nhóm chi tiêu lớn nhất, chiếm ${percent(leader.spend_share)} chi tiêu cấp chiến dịch đã chọn. ${valueLeader.group} dẫn đầu giá trị theo dõi gốc trong ${valueLeader.clean_value_months_won} tháng-tài khoản sạch, nhưng giá trị chiến dịch vẫn mang tính định hướng vì mô hình bất thường chỉ có ở cấp tài khoản-ngày.`,
    )
    : localized('No campaign-group rows match the selected filters.', 'Không có dòng nhóm chiến dịch phù hợp với bộ lọc đã chọn.');
}

function renderCreatives(filters) {
  const rows = filterMonthlyDetail(state.data.creative_formats, filters);
  const summary = summarizeNamedGroups(rows);
  const totalSpend = summary.reduce((sum, row) => sum + row.spend, 0);
  if (!summary.length || !totalSpend) {
    state.charts.creative?.destroy();
    delete state.charts.creative;
    document.getElementById('creativeTable').innerHTML = `<tr><td colspan="6">${localized('No ad-level creative-format rows are available for this selected account/date range.', 'Không có dữ liệu định dạng nội dung cấp quảng cáo cho tài khoản/khoảng thời gian đã chọn.')}</td></tr>`;
    document.getElementById('creativeInsight').textContent = localized('This section can be blank when the selected range falls outside cached ad-level coverage.', 'Phần này có thể trống khi khoảng thời gian đã chọn nằm ngoài phạm vi dữ liệu cấp quảng cáo đã lưu đệm.');
    document.getElementById('creativeCoverageNote').textContent = localized('Known gap: Điện gia dụng ad-level monthly coverage is only available through 2025-09 in the cached export. Campaign/ad set rows still exist, but format inference needs ad-level rows.', 'Khoảng trống đã biết: dữ liệu tháng cấp quảng cáo của Điện gia dụng chỉ có đến 2025-09 trong bản xuất lưu đệm. Dữ liệu chiến dịch/nhóm quảng cáo vẫn có, nhưng suy luận định dạng cần dữ liệu cấp quảng cáo.');
    return;
  }
  document.getElementById('creativeCoverageNote').textContent = '';
  replaceChart('creative', document.getElementById('creativeChart'), {
    type: 'doughnut',
    data: { labels: summary.map((row) => row.group), datasets: [{ data: summary.map((row) => row.spend), backgroundColor: summary.map((_row, index) => PALETTE[index % PALETTE.length]), borderColor: COLORS.chartBorder, borderWidth: 3 }] },
    options: { ...options((item) => `${item.label}: ${money(item.raw)} · ${percent(item.raw / totalSpend)}`, {}, 'nearest'), cutout: '58%' },
  });
  document.getElementById('creativeTable').innerHTML = summary.map((row) => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td></tr>`).join('');
  const video = summary.find((row) => row.group === 'Video');
  const banner = summary.find((row) => row.group === 'Banner / single image');
  const classified = summary.filter((row) => row.group !== 'Unclassified' && row.spend_share >= .01);
  const cppLeader = [...classified].sort((a, b) => a.cost_per_purchase - b.cost_per_purchase)[0];
  const cvrLeader = [...classified].sort((a, b) => b.purchase_cvr - a.purchase_cvr)[0];
  document.getElementById('creativeInsight').textContent = video && banner && cppLeader && cvrLeader
    ? localized(
      `${cppLeader.group} has the lowest observed cost per purchase (${money(cppLeader.cost_per_purchase)}), while ${cvrLeader.group} has the highest purchase CVR (${percent(cvrLeader.purchase_cvr)}) among material classified formats. Video records ${money(video.cost_per_purchase)} / ${percent(video.purchase_cvr)} versus banner / single image at ${money(banner.cost_per_purchase)} / ${percent(banner.purchase_cvr)}. Mix differs by account and month; this is not a causal creative test.`,
      `${cppLeader.group} có chi phí mỗi lượt mua quan sát được thấp nhất (${money(cppLeader.cost_per_purchase)}), trong khi ${cvrLeader.group} có CVR mua hàng cao nhất (${percent(cvrLeader.purchase_cvr)}) trong các định dạng được phân loại có quy mô đáng kể. Video đạt ${money(video.cost_per_purchase)} / ${percent(video.purchase_cvr)}, so với banner / ảnh đơn ở mức ${money(banner.cost_per_purchase)} / ${percent(banner.purchase_cvr)}. Cơ cấu khác nhau theo tài khoản và tháng; đây không phải thử nghiệm nhân quả về nội dung.`,
    )
    : localized('Creative format coverage is incomplete for this selection.', 'Dữ liệu định dạng nội dung chưa đầy đủ cho lựa chọn này.');
}

function summarizeScope(rows, filters) {
  return filterMonthlyDetail(rows, filters).reduce((acc, row) => {
    const key = `${row.account}|${row.category_scope}`;
    if (!acc.has(key)) acc.set(key, { ...row, months_active: 0, spend: 0, purchases: 0, landing_page_views: 0, checkouts: 0, raw_purchase_value: 0 });
    const target = acc.get(key);
    target.months_active = Math.max(target.months_active, Number(row.months_active || 0));
    ['spend', 'purchases', 'landing_page_views', 'checkouts', 'raw_purchase_value'].forEach((metric) => { target[metric] += Number(row[metric] || 0); });
    return acc;
  }, new Map());
}

function renderCategoryScope(filters) {
  const rows = [...summarizeScope(state.data.account_category_scope || [], filters).values()].map((row) => ({
    ...row,
    cost_per_purchase: row.purchases ? row.spend / row.purchases : null,
    purchase_cvr: row.landing_page_views ? row.purchases / row.landing_page_views : null,
  })).sort((a, b) => b.spend - a.spend);
  document.getElementById('categoryScopeTable').innerHTML = rows.slice(0, 18).map((row) => `<tr><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.category_scope)}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(percent(row.spend / rows.filter((item) => item.account === row.account).reduce((sum, item) => sum + item.spend, 0)))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td></tr>`).join('');
  const homeTop = rows.filter((row) => row.account === 'Gia Dụng').slice(0, 3).map((row) => row.category_scope).join(', ');
  const electricTop = rows.filter((row) => row.account === 'Điện gia dụng').slice(0, 3).map((row) => row.category_scope).join(', ');
  document.getElementById('categoryScopeInsight').textContent = localized(
    `Account scope read: Gia Dụng concentrates in kitchen/houseware categories (${homeTop}); Điện gia dụng concentrates in appliance categories (${electricTop}). URL/catalog confirmation is not in the cached export.`,
    `Phạm vi tài khoản: Gia Dụng tập trung vào nhóm nhà bếp/gia dụng (${homeTop}); Điện gia dụng tập trung vào nhóm thiết bị (${electricTop}). Bản xuất lưu đệm không có xác nhận từ URL/catalog.`,
  );
}

function renderCampaignLongevity() {
  const rows = [CAMPAIGN_LONGEVITY.combined, ...CAMPAIGN_LONGEVITY.accounts];
  const chartOptions = options(
    (item) => `${item.label}: ${decimal(item.raw, 1)} ${localized('active days', 'ngày hoạt động')}`,
    {
      x: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: (value) => decimal(value, 0) }, title: { display: true, text: localized('Average active days', 'Số ngày hoạt động trung bình'), color: COLORS.muted } },
      y: { grid: { display: false }, ticks: { color: COLORS.muted } },
    },
    'nearest',
  );
  chartOptions.indexAxis = 'y';
  chartOptions.plugins.legend.display = false;
  replaceChart('campaignLongevity', document.getElementById('campaignLongevityChart'), {
    type: 'bar',
    data: {
      labels: rows.map((row) => row.label === 'Both accounts' ? tr('Both accounts') : row.label),
      datasets: [{ label: localized('Average active days', 'Số ngày hoạt động trung bình'), data: rows.map((row) => row.meanActiveDays), backgroundColor: [`${COLORS.blue}cc`, `${COLORS.green}cc`, `${COLORS.violet}cc`], borderRadius: 7 }],
    },
    options: chartOptions,
  });
  const evidence = [
    [localized('≤ 7 active days', '≤ 7 ngày hoạt động'), CAMPAIGN_LONGEVITY.shareWithin7Days],
    [localized('≤ 14 active days', '≤ 14 ngày hoạt động'), CAMPAIGN_LONGEVITY.shareWithin14Days],
    [localized('≤ 30 active days', '≤ 30 ngày hoạt động'), CAMPAIGN_LONGEVITY.shareWithin30Days],
  ];
  document.getElementById('campaignLongevityEvidence').innerHTML = evidence.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(percent(value))}</strong><p>${localized('of the observational sample', 'trong mẫu quan sát')}</p></article>`).join('');
  document.getElementById('campaignLongevityVerdict').textContent = localized(
    `The observational sample has a median of ${CAMPAIGN_LONGEVITY.combined.medianActiveDays} active days. ${percent(CAMPAIGN_LONGEVITY.shareWithin30Days)} had no more than 30 observed active days.`,
    `Mẫu quan sát có trung vị ${CAMPAIGN_LONGEVITY.combined.medianActiveDays} ngày hoạt động. ${percent(CAMPAIGN_LONGEVITY.shareWithin30Days)} có không quá 30 ngày hoạt động quan sát được.`,
  );
  document.getElementById('campaignLongevityTiming').textContent = localized(
    `Month-boundary check: ${percent(CAMPAIGN_LONGEVITY.startFirstWeek)} started in days 1–7 versus a ${percent(CAMPAIGN_LONGEVITY.uniformCalendarBaseline)} uniform-calendar baseline, while ${percent(CAMPAIGN_LONGEVITY.endLastWeek)} had their last observed delivery in the final seven days. Promotion-expiry timing is unproven.`,
    `Kiểm tra ranh giới tháng: ${percent(CAMPAIGN_LONGEVITY.startFirstWeek)} bắt đầu trong ngày 1–7 so với mức cơ sở lịch đồng đều ${percent(CAMPAIGN_LONGEVITY.uniformCalendarBaseline)}, trong khi ${percent(CAMPAIGN_LONGEVITY.endLastWeek)} có lần phân phối quan sát cuối cùng trong bảy ngày cuối tháng. Chưa có bằng chứng về việc dừng theo hạn khuyến mãi.`,
  );
  document.getElementById('campaignLongevityTable').innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.label === 'Both accounts' ? tr('Both accounts') : row.label)}</td><td>${escapeHtml(count(row.campaigns))}</td><td>${escapeHtml(decimal(row.meanActiveDays, 1))}</td><td>${escapeHtml(count(row.medianActiveDays))}</td></tr>`).join('');
}

function renderSeasonality(filters) {
  const rows = (state.data.seasonality_cells || []).filter((row) => !filters.accounts.length || filters.accounts.includes(row.account));
  document.getElementById('seasonalityTable').innerHTML = rows.slice(0, 10).map((row) => `<tr><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.cell)}</td><td>${escapeHtml(money(row.q4_spend))}</td><td>${escapeHtml(count(row.q4_purchases))}</td><td>${escapeHtml(money(row.q4_cost_per_purchase))}</td><td>${escapeHtml(money(row.non_q4_cost_per_purchase))}</td><td>${escapeHtml(signedPercent(row.cpa_lift_in_q4))}</td><td>${escapeHtml(signedPercent(row.purchase_month_lift_in_q4))}</td></tr>`).join('');
  const leader = rows[0];
  document.getElementById('seasonalityInsight').textContent = leader
    ? localized(`Q4 demand pull is not uniform. ${leader.cell} improved CPA by ${signedPercent(leader.cpa_lift_in_q4)} in Q4 while purchases/month moved ${signedPercent(leader.purchase_month_lift_in_q4)}.`, `Sức kéo nhu cầu Q4 không đồng đều. ${leader.cell} cải thiện CPA ${signedPercent(leader.cpa_lift_in_q4)} trong Q4, trong khi lượt mua/tháng thay đổi ${signedPercent(leader.purchase_month_lift_in_q4)}.`)
    : localized('No material Q4 lift rows match the selected filters.', 'Không có dòng cải thiện Q4 đáng kể phù hợp với bộ lọc đã chọn.');
}

function renderRegional() {
  const rows = state.data.region_monthly;
  const metricKey = document.getElementById('regionMetric').value;
  const metric = METRICS[metricKey] || METRICS.spend;
  const order = { South: 0, North: 1, Mid: 2 };
  const regionLabel = (region) => ({ South: localized('South', 'Miền Nam'), North: localized('North', 'Miền Bắc'), Mid: localized('Mid', 'Miền Trung') })[region] || region;
  const summary = regionSummary(rows).filter((row) => REGION_COLORS[row.region]).sort((a, b) => order[a.region] - order[b.region]);
  replaceChart('regionBaseline', document.getElementById('regionBaselineChart'), {
    data: { labels: summary.map((row) => regionLabel(row.region)), datasets: [
      { type: 'bar', label: tr('Spend share'), data: summary.map((row) => row.spend_share * 100), backgroundColor: summary.map((row) => `${REGION_COLORS[row.region]}bb`), borderRadius: 6, yAxisID: 'share' },
      { type: 'bar', label: localized('Click share', 'Tỷ trọng lượt nhấp'), data: summary.map((row) => row.click_share * 100), backgroundColor: summary.map((row) => `${REGION_COLORS[row.region]}55`), borderColor: summary.map((row) => REGION_COLORS[row.region]), borderWidth: 1, borderRadius: 6, yAxisID: 'share' },
      { type: 'line', label: tr('Cost / click'), data: summary.map((row) => row.cost_per_click), borderColor: COLORS.violet, backgroundColor: COLORS.violet, pointRadius: 5, yAxisID: 'cost' },
    ] },
    options: options((item) => item.dataset.yAxisID === 'cost' ? `${item.dataset.label}: ${money(item.raw)}` : `${item.dataset.label}: ${percent(Number(item.raw) / 100)}`, { x: baseScales().x, share: { beginAtZero: true, position: 'left', grid: { color: COLORS.grid }, ticks: { color: COLORS.muted, callback: (value) => percent(Number(value) / 100) } }, cost: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: COLORS.muted, callback: (value) => compact.format(value) } } }),
  });
  const regions = ['South', 'North', 'Mid'];
  const byRegion = Object.fromEntries(regions.map((region) => [region, monthlyRegionSeries(rows, region)]));
  const labels = [...new Set(rows.filter((row) => REGION_COLORS[row.region]).map((row) => row.month))].sort();
  const totalsByMonth = Object.fromEntries(labels.map((month) => [month, rows.filter((row) => row.month === month && REGION_COLORS[row.region]).reduce((sum, row) => sum + Number(row.spend || 0), 0)]));
  const valueFor = (region, month) => {
    const row = byRegion[region].find((item) => item.month === month);
    if (!row) return null;
    if (metricKey === 'spend_share') return row.spend / totalsByMonth[month];
    if (metricKey === 'cost_per_click') return row.cost_per_click;
    return row[metricKey];
  };
  replaceChart('regionTrend', document.getElementById('regionTrendChart'), {
    type: 'line',
    data: { labels, datasets: regions.map((region) => ({ label: regionLabel(region), data: labels.map((month) => valueFor(region, month)), borderColor: REGION_COLORS[region], backgroundColor: REGION_COLORS[region], borderWidth: region === 'South' ? 3 : 2, pointRadius: 2, tension: .2, spanGaps: true })) },
    options: options((item) => `${item.dataset.label}: ${metric.formatter(item.raw)}`, { x: baseScales().x, y: { ...baseScales().y, ticks: { color: COLORS.muted, callback: metric.tick }, title: { display: true, text: metric.axis, color: COLORS.muted } } }),
  });
  document.getElementById('regionMonthlyTable').innerHTML = labels.map((month) => {
    const south = byRegion.South.find((row) => row.month === month) || {};
    return `<tr><td>${escapeHtml(month)}</td><td>${escapeHtml(money(south.spend))}</td><td>${escapeHtml(percent((south.spend || 0) / totalsByMonth[month]))}</td><td>${escapeHtml(count(south.clicks))}</td><td>${escapeHtml(money(south.cost_per_click))}</td></tr>`;
  }).join('');
}

function renderStructures(filters) {
  const rows = filterMonthlyDetail(state.data.structure_groups || [], filters);
  const summary = summarizeNamedGroups(rows).sort((a, b) => b.spend - a.spend);
  const leader = summary[0];
  document.getElementById('structureInsight').textContent = leader
    ? localized(`${leader.group} is the largest visible setup bucket in the selection at ${percent(leader.spend_share)} of setup-classified spend. AWO is treated as an internal naming label, not as ABO.`, `${leader.group} là nhóm thiết lập hiển thị lớn nhất, chiếm ${percent(leader.spend_share)} chi tiêu đã phân loại theo thiết lập. AWO được xem là nhãn đặt tên nội bộ, không phải ABO.`)
    : localized('No setup rows match the selected account/date range.', 'Không có dòng thiết lập phù hợp với tài khoản/khoảng thời gian đã chọn.');
  document.getElementById('structureTable').innerHTML = summary.length
    ? summary.map((row) => `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(percent(row.spend_share))}</td><td>${escapeHtml(money(row.spend))}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.cost_per_purchase))}</td><td>${escapeHtml(percent(row.purchase_cvr))}</td></tr>`).join('')
    : `<tr><td colspan="6">${localized('No campaign setup rows match this selected account/date range.', 'Không có dòng thiết lập chiến dịch phù hợp với tài khoản/khoảng thời gian đã chọn.')}</td></tr>`;
}

function renderMeasurement(rows, filters) {
  const summary = summarize(rows);
  const removed = summary.raw_purchase_value - summary.modelled_purchase_value;
  document.getElementById('flagCount').textContent = count(summary.flagged_account_days);
  document.getElementById('valueBridge').innerHTML = [
    [localized('Raw tracked value', 'Giá trị theo dõi gốc'), money(summary.raw_purchase_value)],
    [localized('Scenario difference', 'Chênh lệch kịch bản'), `− ${money(removed)}`],
    [tr('Directional value'), money(summary.modelled_purchase_value)],
    [tr('Directional ROAS'), ratio(summary.modelled_roas)],
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  const anomalies = state.data.anomalies.filter((row) => row.date >= filters.from && row.date <= filters.to && (!filters.accounts.length || filters.accounts.includes(row.account)));
  document.getElementById('detailCaption').textContent = localized(`${anomalies.length} flagged account-days in the selected period`, `${anomalies.length} ngày-tài khoản bị gắn cờ trong giai đoạn đã chọn`);
  document.getElementById('detailBody').innerHTML = anomalies.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(count(row.purchases))}</td><td>${escapeHtml(money(row.raw_purchase_value))}</td><td>${escapeHtml(fullMoney(row.baseline_aov))}</td><td>${escapeHtml(money(row.modelled_purchase_value))}</td><td class="cell-risk">${escapeHtml(money(row.excess_purchase_value))}</td></tr>`).join('');
}

function render() {
  const filters = normalizeCurrentFilters();
  const rows = filterDaily(state.data.account_daily, filters);
  renderKpis(rows, filters);
  const series = renderGrowth(rows);
  renderEfficiency(series);
  renderAccounts(rows, filters);
  renderDayOfMonth(rows);
  renderCategoryScope(filters);
  renderCampaignLongevity();
  renderSeasonality(filters);
  renderLeverBoard(filters);
  renderCampaigns(filters);
  renderCreatives(filters);
  renderRegional();
  renderStructures(filters);
  renderMeasurement(rows, filters);
  syncPreset(filters);
  updateUrl(filters);
}

function setPreset(name) {
  const range = presetRanges()[name];
  document.getElementById('dateFrom').value = range.start;
  document.getElementById('dateTo').value = range.end;
  render();
}

function exportCsv() {
  const filters = normalizeCurrentFilters();
  const rows = filterDaily(state.data.account_daily, filters);
  const keys = ['date', 'account', 'spend', 'purchases', 'landing_page_views', 'checkouts', 'modelled_purchase_value', 'flagged'];
  const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `elm-meta-growth-${filters.from}-${filters.to}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindControls() {
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.preset)));
  ['dateFrom', 'dateTo', 'accountFilter', 'growthMetric', 'growthMetricRight', 'accountMetric', 'intramonthMetric', 'intramonthMetricRight', 'intramonthMonth', 'regionMetric']
    .forEach((id) => document.getElementById(id).addEventListener('change', render));
  document.querySelectorAll('.pair-metric').forEach((control) => control.addEventListener('change', render));
  document.getElementById('exportButton').addEventListener('click', exportCsv);
  document.getElementById('languageToggle').addEventListener('click', () => {
    applyLanguage(currentLanguage === 'vi' ? 'en' : 'vi');
  });
  document.getElementById('themeToggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
}

function hydrateFilters() {
  const params = new URLSearchParams(location.search);
  const range = state.data.meta.date_range;
  ['dateFrom', 'dateTo'].forEach((id) => { document.getElementById(id).min = range.start; document.getElementById(id).max = range.end; });
  document.getElementById('dateFrom').value = params.get('from') || '2025-07-01';
  document.getElementById('dateTo').value = params.get('to') || range.end;
  document.getElementById('accountFilter').value = params.get('account') || 'all';
  normalizeCurrentFilters();
}

async function init() {
  captureStaticTranslations();
  applyLanguage(currentLanguage, { persist: false, rerender: false });
  applyTheme(document.documentElement.dataset.theme, { persist: false, rerender: false });
  if (!window.Chart) throw new Error(localized('Chart.js did not load. Check the network and refresh.', 'Không tải được Chart.js. Hãy kiểm tra mạng và tải lại trang.'));
  const response = await fetch('./elm_meta_ads.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(localized(`Dashboard data failed to load (${response.status}).`, `Không tải được dữ liệu bảng điều khiển (${response.status}).`));
  state.data = await response.json();
  window.Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
  document.getElementById('dataStamp').textContent = localized(`${state.data.meta.date_range.start} → ${state.data.meta.date_range.end} · generated ${state.data.meta.generated_at.slice(0, 10)}`, `${state.data.meta.date_range.start} → ${state.data.meta.date_range.end} · tạo ngày ${state.data.meta.generated_at.slice(0, 10)}`);
  document.getElementById('mappingCoverage').textContent = percentWithDigits(state.data.reconciliation.mapped_spend_coverage, 2);
  hydrateFilters();
  bindControls();
  render();
}

init().catch((error) => {
  const target = document.getElementById('errorState');
  target.hidden = false;
  target.textContent = error.message;
  document.getElementById('dataStamp').textContent = localized('Dashboard unavailable', 'Bảng điều khiển không khả dụng');
  console.error(error);
});
