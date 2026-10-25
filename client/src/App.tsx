import { Routes, Route, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from './components/PublicLayout';
import { HomePage } from './pages/HomePage';
import { CatalogPage } from './pages/CatalogPage';
import { CategoryPage } from './pages/CategoryPage';
import { ProductPage } from './pages/ProductPage';
import { SearchPage } from './pages/SearchPage';
import { CartPage } from './pages/CartPage';
import { ToolsPage } from './pages/ToolsPage';
import { PowerCalculatorPage } from './pages/PowerCalculatorPage';
import { WarmFloorCalculatorPage } from './pages/WarmFloorCalculatorPage';
import { WarmFloorProjectPage } from './pages/WarmFloorProjectPage';
import { BuildingProjectPage } from './pages/BuildingProjectPage';
import { AiEngineeringSelectorPage } from './pages/AiEngineeringSelectorPage';
import { ProfilePage } from './pages/ProfilePage';
import { ComparePage } from './pages/ComparePage';
import { BrandsPage } from './pages/BrandsPage';
import { BrandDetailPage } from './pages/BrandDetailPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { DocumentationPage } from './pages/DocumentationPage';
import { ContactsPage } from './pages/ContactsPage';
import { AuthPage } from './pages/AuthPage';
import { StatusPage } from './pages/StatusPage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminHomePage } from './pages/admin/AdminHomePage';
import { AdminCategoriesPage } from './pages/admin/AdminCategoriesPage';
import { AdminCategoryEditPage } from './pages/admin/AdminCategoryEditPage';
import { AdminBrandsPage } from './pages/admin/AdminBrandsPage';
import { AdminBrandEditPage } from './pages/admin/AdminBrandEditPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { AdminProductEditPage } from './pages/admin/AdminProductEditPage';
import { AdminImportPage } from './pages/admin/AdminImportPage';
import { AdminWarmFloorSettingsPage } from './pages/admin/AdminWarmFloorSettingsPage';

function PublicRoutes() {
  const { t } = useTranslation();

  return (
    <PublicLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:slug/*" element={<CategoryPage />} />
        <Route path="/category/:slug" element={<CategoryPage />} />
        <Route path="/product/:slug" element={<ProductPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/brands" element={<BrandsPage />} />
        <Route path="/brands/:slug" element={<BrandDetailPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/power-calculator" element={<PowerCalculatorPage />} />
        <Route path="/tools/warm-floor" element={<WarmFloorCalculatorPage />} />
        <Route path="/tools/warm-floor/project" element={<WarmFloorProjectPage />} />
        <Route path="/tools/building-project" element={<BuildingProjectPage />} />
        <Route path="/tools/ai-engineering-selector" element={<AiEngineeringSelectorPage />} />
        <Route path="/promotions" element={<PlaceholderPage title={t('placeholder.promotions.title')} text={t('placeholder.promotions.text')} />} />
        <Route path="/documentation" element={<DocumentationPage />} />
        <Route path="/docs" element={<DocumentationPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="*" element={<StatusPage code={404} />} />
      </Routes>
    </PublicLayout>
  );
}

function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminHomePage />} />
      <Route path="/admin/categories" element={<AdminCategoriesPage />} />
      <Route path="/admin/categories/new" element={<AdminCategoryEditPage />} />
      <Route path="/admin/categories/:id/edit" element={<AdminCategoryEditPage />} />
      <Route path="/admin/brands" element={<AdminBrandsPage />} />
      <Route path="/admin/brands/new" element={<AdminBrandEditPage />} />
      <Route path="/admin/brands/:id/edit" element={<AdminBrandEditPage />} />
      <Route path="/admin/products" element={<AdminProductsPage />} />
      <Route path="/admin/products/new" element={<AdminProductEditPage />} />
      <Route path="/admin/products/:id/edit" element={<AdminProductEditPage />} />
      <Route path="/admin/warm-floor" element={<AdminWarmFloorSettingsPage />} />
      <Route path="/admin/import" element={<AdminImportPage />} />
    </Routes>
  );
}

export default function App() {
  const location = useLocation();
  return location.pathname.startsWith('/admin') ? <AdminRoutes /> : <PublicRoutes />;
}
