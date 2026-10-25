/**
 * Compatibility shim: canonical navigation is useNavigation().
 * Kept so existing imports continue to resolve to the single source.
 */
export {
  useNavigation as useCanonicalCategoryMenu,
  useNavigation,
  type NavigationNode as CanonicalCategoryMenuNode,
} from './useNavigation';
