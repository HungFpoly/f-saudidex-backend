/**
 * Seed Supabase with mock company data + related records.
 * Run: npx tsx scripts/seed-mock-data.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// Companies
// ============================================================

const COMPANIES = [
  {
    id: '100001', slug: 'alfanar-group', slug_en: 'alfanar-group', slug_ar: 'alfanar-group',
    name_en: 'Alfanar Group', name_ar: 'مجموعة الفنار',
    business_type: 'manufacturer',
    description_en: 'Leading Saudi manufacturer of electrical cables, wiring accessories, and electrical distribution products with over 40 years of experience.',
    description_ar: 'شركة رائدة في تصنيع الكابلات الكهربائية وملحقات التوصيل ومنتجات التوزيع الكهربائي بخبرة تزيد عن 40 عامًا.',
    scope_en: 'Design, manufacture and supply of electrical cables, switchgear, and distribution products for industrial, commercial, and residential applications across the Middle East and North Africa.',
    scope_ar: 'تصنيع وتصميم وتوريد الكابلات الكهربائية ولوحات التوزيع ومنتجات التوزيع الكهربائي للتطبيقات الصناعية والتجارية والسكنية.',
    logo_url: 'https://picsum.photos/seed/alfanar/200/200',
    cover_image_url: 'https://picsum.photos/seed/alfanar-cover/1200/600',
    website_url: 'https://www.alfanar.com', linkedin_url: 'https://www.linkedin.com/company/alfanar',
    email: 'info@alfanar.com', sales_email: 'sales@alfanar.com', procurement_email: 'procurement@alfanar.com',
    phone: '+966 11 234 5678', whatsapp: '+966 55 123 4567',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'Alfanar Road, Al Sulaimaniyah, Riyadh 12244, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.95, data_source: 'seed',
    categories: ['electrical'], brands: ['Alfanar', 'Alfanar Construction'],
    products: ['Power Cables', 'Wiring Accessories', 'Switchgear', 'Circuit Breakers', 'Distribution Boards', 'Transformers'],
    fields: ['Electrical Manufacturing', 'Industrial Equipment', 'Construction'],
    created_at: '2024-01-15T08:00:00.000Z', updated_at: '2024-03-20T10:30:00.000Z',
  },
  {
    id: '100002', slug: 'sabic', slug_en: 'sabic', slug_ar: 'sabic',
    name_en: 'SABIC', name_ar: 'سابك',
    business_type: 'manufacturer',
    description_en: 'Saudi Basic Industries Corporation - global leader in diversified chemicals, plastics, metals, and agriculture.',
    description_ar: 'الشركة السعودية للصناعات الأساسية - رائدة عالمية في الكيماويات والبلاستيك والمعادن والزراعة.',
    scope_en: 'Global manufacturing of chemicals, plastics, agri-nutrients, and metals serving construction, healthcare, automotive, and energy sectors.',
    scope_ar: 'التصنيع العالمي للكيماويات واللدائن والمغذيات الزراعية والمعادن لقطاعات البناء والرعاية الصحية والسيارات والطاقة.',
    logo_url: 'https://picsum.photos/seed/sabic/200/200',
    cover_image_url: 'https://picsum.photos/seed/sabic-cover/1200/600',
    website_url: 'https://www.sabic.com', linkedin_url: 'https://www.linkedin.com/company/sabic',
    email: 'info@sabic.com', sales_email: 'sales@sabic.com', procurement_email: 'procurement@sabic.com',
    phone: '+966 11 225 8000',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'SABIC Headquarters, King Fahd Road, Riyadh 11422, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.98, data_source: 'seed',
    categories: ['chemicals'], brands: ['SABIC', 'Lexan', 'Noryl', 'Ultem'],
    products: ['Polymers', 'Chemicals', 'Metals', 'Fertilizers', 'Specialty Compounds'],
    fields: ['Petrochemicals', 'Materials Science', 'Manufacturing'],
    created_at: '2024-01-10T08:00:00.000Z', updated_at: '2024-04-01T14:00:00.000Z',
  },
  {
    id: '100003', slug: 'zamil-industrial', slug_en: 'zamil-industrial', slug_ar: 'zamil-industrial',
    name_en: 'Zamil Industrial', name_ar: 'زاميل الصناعية',
    business_type: 'manufacturer',
    description_en: 'Major Saudi manufacturer of steel structures, pre-engineered buildings, and industrial solutions.',
    description_ar: 'شركة رائدة في تصنيع الهياكل المعدنية والمباني الجاهزة والحلول الصناعية.',
    scope_en: 'Engineering, manufacturing, and erection of steel structures, pre-engineered buildings, HVAC systems, and industrial insulation.',
    scope_ar: 'هنداء وتصنيع وتركيب الهياكل المعدنية والمباني الجاهزة وأنظمة التكييف والعزل الصناعي.',
    logo_url: 'https://picsum.photos/seed/zamil/200/200',
    cover_image_url: 'https://picsum.photos/seed/zamil-cover/1200/600',
    website_url: 'https://www.zamilindustrial.com', linkedin_url: 'https://www.linkedin.com/company/zamil-industrial',
    email: 'info@zamilindustrial.com', sales_email: 'sales@zamilindustrial.com', procurement_email: 'purchasing@zamil.com',
    phone: '+966 13 839 9999',
    city_id: 'dammam', region_id: 'eastern-province', full_address: 'Zamil Tower, King Fahd Road, Dammam 31952, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.92, data_source: 'seed',
    categories: ['construction'], brands: ['Zamil Steel', 'Zamil HVAC'],
    products: ['Steel Structures', 'Pre-engineered Buildings', 'HVAC Systems', 'Insulation Materials'],
    fields: ['Steel Manufacturing', 'Construction', 'Engineering'],
    created_at: '2024-01-20T09:00:00.000Z', updated_at: '2024-03-15T11:00:00.000Z',
  },
  {
    id: '100004', slug: 'nahdi-medical', slug_en: 'nahdi-medical', slug_ar: 'nahdi-medical',
    name_en: 'Nahdi Medical', name_ar: 'نهدي الطبية',
    business_type: 'vendor',
    description_en: 'Largest pharmacy and healthcare retailer in Saudi Arabia with over 1,300 branches.',
    description_ar: 'أكبر صيدلية وتجزئة رعاية صحية في المملكة العربية السعودية بأكثر من 1300 فرع.',
    scope_en: 'Retail pharmacy operations, healthcare products, medical supplies distribution, and e-commerce pharmacy services.',
    scope_ar: 'عمليات الصيدلة التجزئة ومنتجات الرعاية الصحية وتوزيع المستلزمات الطبية وخدمات الصيدلة الإلكترونية.',
    logo_url: 'https://picsum.photos/seed/nahdi/200/200',
    cover_image_url: 'https://picsum.photos/seed/nahdi-cover/1200/600',
    website_url: 'https://www.nahdi.sa', linkedin_url: 'https://www.linkedin.com/company/nahdi-medical',
    email: 'info@nahdi.sa', sales_email: 'b2b@nahdi.sa', procurement_email: 'procurement@nahdi.sa',
    phone: '+966 12 698 0000', whatsapp: '+966 50 300 0000',
    city_id: 'jeddah', region_id: 'makkah', full_address: 'Nahdi Medical Company, Prince Sultan St, Jeddah 21442, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.93, data_source: 'seed',
    categories: ['healthcare'], brands: ['Nahdi'],
    products: ['Pharmaceuticals', 'Medical Supplies', 'Healthcare Products', 'Cosmetics', 'Baby Care'],
    fields: ['Retail Pharmacy', 'Healthcare', 'E-commerce'],
    created_at: '2024-02-01T10:00:00.000Z', updated_at: '2024-04-10T16:00:00.000Z',
  },
  {
    id: '100005', slug: 'jarir-marketing', slug_en: 'jarir-marketing', slug_ar: 'jarir-marketing',
    name_en: 'Jarir Marketing', name_ar: 'جرير للتسويق',
    business_type: 'vendor',
    description_en: 'Leading Saudi retailer of books, electronics, office supplies, and educational materials.',
    description_ar: 'شركة رائدة في تجزئة الكتب والإلكترونيات والمستلزمات المكتبية والتعليمية.',
    scope_en: 'Retail and distribution of consumer electronics, books, office supplies, school supplies, and home furniture.',
    scope_ar: 'تجزئة وتوزيع الإلكترونيات الاستهلاكية والكتب والمستلزمات المكتبية والمدرسية والأثاث المنزلي.',
    logo_url: 'https://picsum.photos/seed/jarir/200/200',
    cover_image_url: 'https://picsum.photos/seed/jarir-cover/1200/600',
    website_url: 'https://www.jarir.com', linkedin_url: 'https://www.linkedin.com/company/jarir',
    email: 'support@jarir.com', sales_email: 'corporate@jarir.com', procurement_email: 'buying@jarir.com',
    phone: '+966 11 216 9000',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'Jarir Bookstore HQ, Olaya Street, Riyadh 12211, Saudi Arabia',
    is_verified: true, is_featured: false, status: 'approved',
    confidence_score: 0.90, data_source: 'seed',
    categories: ['technology'], brands: ['Jarir'],
    products: ['Electronics', 'Books', 'Office Supplies', 'Furniture', 'Computers', 'Mobile Phones'],
    fields: ['Retail', 'E-commerce', 'Technology'],
    created_at: '2024-02-05T10:00:00.000Z', updated_at: '2024-03-25T12:00:00.000Z',
  },
  {
    id: '100006', slug: 'almarai', slug_en: 'almarai', slug_ar: 'almarai',
    name_en: 'Almarai Company', name_ar: 'شركة المراعي',
    business_type: 'manufacturer',
    description_en: 'World\'s largest vertically integrated dairy company, producing fresh milk, juice, bakery, and poultry products.',
    description_ar: 'أكبر شركة ألبان متكاملة رأسياً في العالم، تنتج الحليب الطازج والعصائر والمخبوزات والدواجن.',
    scope_en: 'Dairy farming, milk processing, juice production, bakery manufacturing, and poultry operations across the GCC.',
    scope_ar: 'تربية الأبقار ومعالجة الألبان وإنتاج العصائر وتصنيع المخبوزات وعمليات الدواجن في دول مجلس التعاون الخليجي.',
    logo_url: 'https://picsum.photos/seed/almarai/200/200',
    cover_image_url: 'https://picsum.photos/seed/almarai-cover/1200/600',
    website_url: 'https://www.almarai.com', linkedin_url: 'https://www.linkedin.com/company/almarai',
    email: 'consumer@almarai.com', sales_email: 'b2b@almarai.com', procurement_email: 'procurement@almarai.com',
    phone: '+966 11 500 3333', whatsapp: '+966 55 500 3333',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'Almarai Company, Exit 17, King Fahd Road, Riyadh 13241, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.97, data_source: 'seed',
    categories: ['food-beverage'], brands: ['Almarai', 'L\'usine', '7Days', 'Alyoum'],
    products: ['Fresh Milk', 'Yogurt', 'Cheese', 'Juice', 'Bakery Products', 'Poultry'],
    fields: ['Food & Beverage', 'Dairy Manufacturing', 'FMCG'],
    created_at: '2024-01-05T07:00:00.000Z', updated_at: '2024-04-12T09:00:00.000Z',
  },
  {
    id: '100007', slug: 'acwa-power', slug_en: 'acwa-power', slug_ar: 'acwa-power',
    name_en: 'ACWA Power', name_ar: 'أكوا باور',
    business_type: 'manufacturer',
    description_en: 'Leading Saudi developer, investor, and operator of power generation and desalinated water plants.',
    description_ar: 'شركة رائدة في تطوير واستثمار وتشغيل محطات توليد الكهرباء وتحلية المياه.',
    scope_en: 'Development, investment, operation and maintenance of power generation, water desalination, and green hydrogen projects globally.',
    scope_ar: 'تطوير واستثمار وتشغيل وصيانة مشاريع توليد الكهرباء وتحلية المياه والهيدروجين الأخضر عالمياً.',
    logo_url: 'https://picsum.photos/seed/acwa/200/200',
    cover_image_url: 'https://picsum.photos/seed/acwa-cover/1200/600',
    website_url: 'https://www.acwapower.com', linkedin_url: 'https://www.linkedin.com/company/acwa-power',
    email: 'info@acwapower.com', sales_email: 'business@acwapower.com', procurement_email: 'procurement@acwapower.com',
    phone: '+966 11 218 5005',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'ACWA Power HQ, King Abdullah Financial District, Riyadh 13519, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.94, data_source: 'seed',
    categories: ['energy'], brands: ['ACWA Power'],
    products: ['Power Generation', 'Water Desalination', 'Green Hydrogen', 'Solar Energy'],
    fields: ['Energy', 'Renewable Energy', 'Infrastructure'],
    created_at: '2024-02-10T08:00:00.000Z', updated_at: '2024-04-05T11:00:00.000Z',
  },
  {
    id: '100008', slug: 'stc', slug_en: 'stc', slug_ar: 'stc',
    name_en: 'STC (Saudi Telecom)', name_ar: 'الاتصالات السعودية',
    business_type: 'vendor',
    description_en: 'Saudi Arabia\'s largest telecommunications provider offering mobile, internet, and digital solutions.',
    description_ar: 'أكبر مزود للاتصالات في المملكة العربية السعودية يقدم خدمات الجوال والإنترنت والحلول الرقمية.',
    scope_en: 'Telecommunications services including mobile networks, broadband, cloud computing, IoT, and enterprise digital transformation.',
    scope_ar: 'خدمات الاتصالات بما في ذلك شبكات الجوال والنطاق العريض والحوسبة السحابية وإنترنت الأشياء والتحول الرقمي للمؤسسات.',
    logo_url: 'https://picsum.photos/seed/stc/200/200',
    cover_image_url: 'https://picsum.photos/seed/stc-cover/1200/600',
    website_url: 'https://www.stc.com.sa', linkedin_url: 'https://www.linkedin.com/company/stc',
    email: 'info@stc.com.sa', sales_email: 'enterprise@stc.com.sa', procurement_email: 'supply@stc.com.sa',
    phone: '+966 11 455 5555', whatsapp: '+966 50 500 0000',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'STC Headquarters, King Abdulaziz Road, Riyadh 11564, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.96, data_source: 'seed',
    categories: ['technology'], brands: ['STC', 'stc pay', 'solutions'],
    products: ['Mobile Services', 'Broadband', 'Cloud Services', 'IoT Solutions', 'Enterprise IT'],
    fields: ['Telecommunications', 'Digital Services', 'Technology'],
    created_at: '2024-01-25T08:00:00.000Z', updated_at: '2024-04-08T10:00:00.000Z',
  },
  {
    id: '100009', slug: 'saudi-arabian-mining', slug_en: 'saudi-arabian-mining', slug_ar: 'saudi-arabian-mining',
    name_en: 'Ma\'aden (Saudi Arabian Mining)', name_ar: 'معادن (التعدين السعودية)',
    business_type: 'manufacturer',
    description_en: 'Saudi mining giant extracting gold, copper, phosphate, and aluminum for domestic and global markets.',
    description_ar: 'عملاق التعدين السعودي يستخرج الذهب والنحاس والفوسفات والألومنيوم للأسواق المحلية والعالمية.',
    scope_en: 'Mining operations for gold, copper, phosphate, bauxite, and aluminum processing across Saudi Arabia.',
    scope_ar: 'عمليات التعدين للذهب والنحاس والفوسفات والبوكسيت ومعالجة الألومنيوم في جميع أنحاء المملكة.',
    logo_url: 'https://picsum.photos/seed/maaden/200/200',
    cover_image_url: 'https://picsum.photos/seed/maaden-cover/1200/600',
    website_url: 'https://www.maaden.com.sa', linkedin_url: 'https://www.linkedin.com/company/maaden',
    email: 'info@maaden.com.sa', sales_email: 'sales@maaden.com.sa', procurement_email: 'procurement@maaden.com.sa',
    phone: '+966 11 218 7000',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'Ma\'aden Tower, King Fahd Road, Riyadh 12314, Saudi Arabia',
    is_verified: true, is_featured: true, status: 'approved',
    confidence_score: 0.95, data_source: 'seed',
    categories: ['manufacturing'], brands: ['Ma\'aden'],
    products: ['Gold', 'Copper', 'Phosphate', 'Aluminum', 'Fertilizers'],
    fields: ['Mining', 'Metals', 'Industrial Manufacturing'],
    created_at: '2024-01-18T08:00:00.000Z', updated_at: '2024-04-02T09:00:00.000Z',
  },
  {
    id: '100010', slug: 'arabian-cement', slug_en: 'arabian-cement', slug_ar: 'arabian-cement',
    name_en: 'Arabian Cement Company', name_ar: 'الشركة العربية للأسمنت',
    business_type: 'manufacturer',
    description_en: 'One of the largest cement producers in Saudi Arabia serving construction and infrastructure projects.',
    description_ar: 'واحدة من أكبر شركات إنتاج الأسمنت في المملكة العربية السعودية لخدمة مشاريع البناء والبنية التحتية.',
    scope_en: 'Manufacturing and distribution of Portland cement, ready-mix concrete, and building materials for construction sector.',
    scope_ar: 'تصنيع وتوزيع الأسمنت البورتلاندي والخرسانة الجاهزة ومواد البناء لقطاع الإنشاءات.',
    logo_url: 'https://picsum.photos/seed/acc/200/200',
    cover_image_url: 'https://picsum.photos/seed/acc-cover/1200/600',
    website_url: 'https://www.arabiacement.com', linkedin_url: 'https://www.linkedin.com/company/arabian-cement',
    email: 'info@arabiacement.com', sales_email: 'sales@arabiacement.com',
    phone: '+966 11 440 8888',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'Arabian Cement Co, Industrial Area, Riyadh 11461, Saudi Arabia',
    is_verified: true, is_featured: false, status: 'approved',
    confidence_score: 0.88, data_source: 'seed',
    categories: ['construction'], brands: ['ACC'],
    products: ['Ordinary Portland Cement', 'Ready-Mix Concrete', 'Building Materials'],
    fields: ['Cement Manufacturing', 'Construction Materials', 'Building'],
    created_at: '2024-03-01T08:00:00.000Z', updated_at: '2024-04-09T10:00:00.000Z',
  },
  {
    id: '100011', slug: 'mouwasat-medical', slug_en: 'mouwasat-medical', slug_ar: 'mouwasat-medical',
    name_en: 'Mouwasat Medical Services', name_ar: 'المواساة للخدمات الطبية',
    business_type: 'vendor',
    description_en: 'Premier healthcare provider operating hospitals and medical centers across eastern Saudi Arabia.',
    description_ar: 'مزود رعاية صحية رائد يدير مستشفيات ومراكز طبية في شرق المملكة العربية السعودية.',
    scope_en: 'Hospital operations, outpatient clinics, specialized medical services, and healthcare facility management.',
    scope_ar: 'عمليات المستشفيات والعيادات الخارجية والخدمات الطبية المتخصصة وإدارة المرافق الصحية.',
    logo_url: 'https://picsum.photos/seed/mouwasat/200/200',
    cover_image_url: 'https://picsum.photos/seed/mouwasat-cover/1200/600',
    website_url: 'https://www.mouwasat.com', linkedin_url: 'https://www.linkedin.com/company/mouwasat',
    email: 'info@mouwasat.com', sales_email: 'corporate@mouwasat.com',
    phone: '+966 13 814 5555', whatsapp: '+966 50 700 0000',
    city_id: 'dammam', region_id: 'eastern-province', full_address: 'Mouwasat Hospital, Al Shatea District, Dammam 32241, Saudi Arabia',
    is_verified: true, is_featured: false, status: 'approved',
    confidence_score: 0.91, data_source: 'seed',
    categories: ['healthcare'], brands: ['Mouwasat'],
    products: ['Hospital Services', 'Medical Equipment', 'Pharmaceuticals', 'Laboratory Services'],
    fields: ['Healthcare', 'Medical Services', 'Hospital Management'],
    created_at: '2024-02-15T09:00:00.000Z', updated_at: '2024-04-11T13:00:00.000Z',
  },
  {
    id: '100012', slug: 'extra-stores', slug_en: 'extra-stores', slug_ar: 'extra-stores',
    name_en: 'eXtra Stores (United Electronics)', name_ar: 'إكسترا (الإلكترونيات المتحدة)',
    business_type: 'vendor',
    description_en: 'Saudi Arabia\'s largest consumer electronics and home appliance retailer.',
    description_ar: 'أكبر تجزئة للإلكترونيات الاستهلاكية والأجهزة المنزلية في المملكة العربية السعودية.',
    scope_en: 'Retail of consumer electronics, home appliances, mobile devices, and e-commerce platform operations.',
    scope_ar: 'تجزئة الإلكترونيات الاستهلاكية والأجهزة المنزلية والأجهزة المحمولة وتشغيل المنصة الإلكترونية.',
    logo_url: 'https://picsum.photos/seed/extra/200/200',
    cover_image_url: 'https://picsum.photos/seed/extra-cover/1200/600',
    website_url: 'https://www.extra.com', linkedin_url: 'https://www.linkedin.com/company/extra-stores',
    email: 'info@extra.com', sales_email: 'b2b@extra.com', procurement_email: 'procurement@extra.com',
    phone: '+966 11 284 7000', whatsapp: '+966 50 800 0000',
    city_id: 'riyadh', region_id: 'riyadh', full_address: 'United Electronics Co, King Fahd Road, Riyadh 11564, Saudi Arabia',
    is_verified: true, is_featured: false, status: 'approved',
    confidence_score: 0.89, data_source: 'seed',
    categories: ['technology'], brands: ['eXtra'],
    products: ['Consumer Electronics', 'Home Appliances', 'Mobile Phones', 'Computers', 'Gaming'],
    fields: ['Retail', 'Consumer Electronics', 'E-commerce'],
    created_at: '2024-02-20T10:00:00.000Z', updated_at: '2024-04-06T15:00:00.000Z',
  },
  // 2 pending companies for admin moderation testing
  {
    id: '100013', slug: 'new-tech-solutions', slug_en: 'new-tech-solutions', slug_ar: 'new-tech-solutions',
    name_en: 'New Tech Solutions', name_ar: 'حلول التقنية الجديدة',
    business_type: 'vendor',
    description_en: 'An emerging IT services provider based in Jeddah specializing in cloud and cybersecurity.',
    description_ar: 'مزود خدمات تقنية ناشئ في جدة متخصص في الحوسبة السحابية والأمن السيبراني.',
    logo_url: 'https://picsum.photos/seed/newtech/200/200',
    cover_image_url: 'https://picsum.photos/seed/newtech-cover/1200/600',
    website_url: 'https://www.newtechsa.com',
    email: 'contact@newtechsa.com', phone: '+966 12 600 0000',
    city_id: 'jeddah', region_id: 'makkah', full_address: 'Jeddah, Saudi Arabia',
    is_verified: false, is_featured: false, status: 'pending',
    confidence_score: 0.5, data_source: 'seed',
    categories: ['technology'], brands: [],
    products: ['Cloud Services', 'Cybersecurity'],
    fields: ['IT Services'],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: '100014', slug: 'gulf-petrochemical', slug_en: 'gulf-petrochemical', slug_ar: 'gulf-petrochemical',
    name_en: 'Gulf Petrochemical Industries', name_ar: 'صناعات البتروكيماويات الخليجية',
    business_type: 'manufacturer',
    description_en: 'A petrochemical manufacturing facility under review for listing.',
    description_ar: 'منشأة تصنيع بتروكيماويات قيد المراجعة للإدراج.',
    logo_url: 'https://picsum.photos/seed/gulfpetro/200/200',
    cover_image_url: 'https://picsum.photos/seed/gulfpetro-cover/1200/600',
    website_url: 'https://www.gulfpetrosa.com',
    email: 'info@gulfpetrosa.com', phone: '+966 13 700 0000',
    city_id: 'jubail', region_id: 'eastern-province', full_address: 'Jubail Industrial City, Saudi Arabia',
    is_verified: false, is_featured: false, status: 'pending',
    confidence_score: 0.5, data_source: 'seed',
    categories: ['chemicals'], brands: [],
    products: ['Petrochemicals', 'Industrial Chemicals'],
    fields: ['Petrochemicals'],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  // 2 rejected companies for admin testing
  {
    id: '100015', slug: 'invalid-company', slug_en: 'invalid-company', slug_ar: 'invalid-company',
    name_en: 'Invalid Company Test', name_ar: 'اختبار شركة غير صالحة',
    business_type: 'vendor',
    description_en: 'This company was rejected during moderation.',
    description_ar: 'تم رفض هذه الشركة أثناء المراجعة.',
    logo_url: '', cover_image_url: '',
    website_url: '',
    email: '', phone: '',
    city_id: 'riyadh', region_id: 'riyadh', full_address: '',
    is_verified: false, is_featured: false, status: 'rejected',
    confidence_score: 0.3, data_source: 'seed',
    categories: [], brands: [], products: [], fields: [],
    created_at: '2024-03-01T08:00:00.000Z', updated_at: '2024-03-01T08:00:00.000Z',
  },
];

// ============================================================
// Related data
// ============================================================

const INQUIRIES = [
  {
    id: 'inq-001', company_id: '100001', company_name: 'Alfanar Group',
    sender_id: null, sender_name: 'Ahmed Al-Rashid', sender_email: 'ahmed@saudidex.vercel.app',
    sender_phone: '+966 55 111 2222', subject: 'Bulk cable order inquiry',
    message: 'We are looking for 500km of 400kV power cables for a project in NEOM. Can you provide a quote?',
    status: 'new', type: 'quote',
    created_at: '2024-04-10T14:00:00.000Z',
  },
  {
    id: 'inq-002', company_id: '100006', company_name: 'Almarai Company',
    sender_id: null, sender_name: 'Sara Al-Qahtani', sender_email: 'sara@retailco.sa',
    sender_phone: '+966 50 333 4444', subject: 'Partnership Opportunity',
    message: 'We operate a chain of 50 supermarkets and would like to discuss a supply partnership for dairy products.',
    status: 'sent', type: 'partnership',
    created_at: '2024-04-08T10:00:00.000Z',
  },
  {
    id: 'inq-003', company_id: '100002', company_name: 'SABIC',
    sender_id: null, sender_name: 'Omar Hassan', sender_email: 'omar@buildmat.com',
    sender_phone: '', subject: 'Request for chemical supply quote',
    message: 'We need a regular supply of polycarbonate resins for our manufacturing. Please send pricing for 20 tons/month.',
    status: 'read', type: 'quote',
    created_at: '2024-04-05T09:00:00.000Z',
  },
  {
    id: 'inq-004', company_id: '100007', company_name: 'ACWA Power',
    sender_id: null, sender_name: 'Khalid Al-Mutairi', sender_email: 'khalid@greentech.sa',
    sender_phone: '+966 55 777 8888', subject: 'Green hydrogen collaboration',
    message: 'Our company is interested in partnering on green hydrogen projects. Can we schedule a meeting to discuss opportunities?',
    status: 'new', type: 'partnership',
    created_at: '2024-04-13T08:00:00.000Z',
  },
];

const CLAIM_REQUESTS = [
  {
    id: 'claim-001', company_id: '100004', company_name: 'Nahdi Medical',
    claimant_name: 'Fahad Al-Nahdi', claimant_email: 'fahdi@nahdi.sa', claimant_phone: '+966 50 100 2000',
    status: 'pending', note: 'I am the official representative of Nahdi Medical. Happy to provide documentation.',
    created_at: '2024-04-11T12:00:00.000Z', updated_at: '2024-04-11T12:00:00.000Z',
  },
  {
    id: 'claim-002', company_id: '100008', company_name: 'STC (Saudi Telecom)',
    claimant_name: 'Noura Al-Saud', claimant_email: 'noura@stc.com.sa', claimant_phone: '+966 55 200 3000',
    status: 'pending', note: 'Corporate communications team claiming the company profile for management.',
    created_at: '2024-04-12T15:00:00.000Z', updated_at: '2024-04-12T15:00:00.000Z',
  },
];

const CRAWL_SCHEDULES = [
  {
    id: 'sched-001', url: 'https://www.alfanar.com', frequency: 'weekly',
    is_active: true, last_run_at: '2024-04-08T06:00:00.000Z',
    next_run_at: '2024-04-15T06:00:00.000Z',
    created_at: '2024-01-15T08:00:00.000Z', updated_at: '2024-04-08T06:30:00.000Z',
  },
  {
    id: 'sched-002', url: 'https://www.sabic.com', frequency: 'monthly',
    is_active: true, last_run_at: '2024-04-01T04:00:00.000Z',
    next_run_at: '2024-05-01T04:00:00.000Z',
    created_at: '2024-01-10T08:00:00.000Z', updated_at: '2024-04-01T04:30:00.000Z',
  },
  {
    id: 'sched-003', url: 'https://www.almarai.com', frequency: 'daily',
    is_active: false, last_run_at: '2024-03-20T02:00:00.000Z',
    next_run_at: null,
    created_at: '2024-01-05T07:00:00.000Z', updated_at: '2024-03-20T02:30:00.000Z',
  },
];

const AI_LOGS = [
  {
    id: 'ailog-001', provider: 'gemini', model: 'gemini-2.0-flash', type: 'discovery',
    status: 'success', duration_ms: 45230, error_message: null,
    usage: { prompt_tokens: 2500, completion_tokens: 1800 },
    request_payload: { url: 'https://www.alfanar.com', pages: 5 },
    response_payload: { companies_found: 1, confidence: 0.95 },
    created_at: '2024-04-10T08:30:00.000Z',
  },
  {
    id: 'ailog-002', provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', type: 'enrichment',
    status: 'success', duration_ms: 32100, error_message: null,
    usage: { prompt_tokens: 8000, completion_tokens: 1200 },
    request_payload: { company_id: '100001', pages_scraped: 3 },
    response_payload: { fields_enriched: ['sales_email', 'procurement_email', 'linkedin_url'] },
    created_at: '2024-04-09T14:00:00.000Z',
  },
  {
    id: 'ailog-003', provider: 'groq', model: 'llama-3.1-70b', type: 'discovery',
    status: 'error', duration_ms: 15000, error_message: 'Rate limit exceeded',
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    request_payload: { url: 'https://saudidex.vercel.app', pages: 10 },
    response_payload: null,
    created_at: '2024-04-08T20:00:00.000Z',
  },
];

// ============================================================
// Seed function
// ============================================================

async function seedTable(tableName: string, rows: Record<string, unknown>[], clear = true) {
  console.log(`\n📦 Seeding ${tableName}...`);

  if (clear) {
    const { error } = await supabase.from(tableName).delete().neq('id', '0');
    if (error) console.log(`   ⚠️  Clear warning: ${error.message}`);
    else console.log(`   ✅ Cleared existing data`);
  }

  let success = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase.from(tableName).upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`   ❌ Batch error: ${error.message}`);
      errors += batch.length;
    } else {
      success += batch.length;
    }
  }

  console.log(`   ✅ ${success} rows inserted, ${errors} errors`);
  return { success, errors };
}

async function seed() {
  console.log('🌱 Seeding mock data into Supabase...\n');
  console.log('='.repeat(50));

  // Companies
  const { success: companyCount } = await seedTable('companies', COMPANIES as any, true);

  // Related data
  const { success: inquiryCount } = await seedTable('inquiries', INQUIRIES as any, true);
  const { success: claimCount } = await seedTable('claim_requests', CLAIM_REQUESTS as any, true);
  const { success: scheduleCount } = await seedTable('crawl_schedules', CRAWL_SCHEDULES as any, true);
  const { success: aiLogCount } = await seedTable('ai_logs', AI_LOGS as any, true);

  // Update counter
  const maxId = 100015;
  await supabase.from('metadata').upsert({ id: 'company_counter', lastId: maxId }, { onConflict: 'id' });

  // Verify
  console.log('\n' + '='.repeat(50));
  console.log('📊 Verification');
  console.log('='.repeat(50));

  const tables = ['companies', 'inquiries', 'claim_requests', 'crawl_schedules', 'ai_logs'];
  for (const table of tables) {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    console.log(`   ${table}: ${count || 0} rows`);
  }

  // Company breakdown
  const { count: approved } = await supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'approved');
  const { count: pending } = await supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: rejected } = await supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'rejected');
  const { count: verified } = await supabase.from('companies').select('*', { count: 'exact', head: true }).eq('is_verified', true);

  console.log('\n   Company breakdown:');
  console.log(`     ✅ Approved: ${approved || 0}`);
  console.log(`     ⏳ Pending: ${pending || 0}`);
  console.log(`     ❌ Rejected: ${rejected || 0}`);
  console.log(`     🔒 Verified: ${verified || 0}`);

  console.log('\n' + '='.repeat(50));
  console.log('✅ Seeding complete!');
  console.log('='.repeat(50));
}

seed().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
