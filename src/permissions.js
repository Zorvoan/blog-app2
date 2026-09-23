'use strict';

// Pravidla oprávnění. Záměrně "wiki" přístup: každý přihlášený uživatel
// může upravovat publikované příspěvky ostatních; historie revizí
// umožňuje vrátit jakoukoliv změnu. Mazání je vyhrazeno autorovi a adminovi.

const isAdmin = (user) => user?.role === 'admin';
const isOwner = (user, authorId) => !!user && authorId != null && user.id === authorId;

module.exports = {
  isAdmin,
  canViewPost: (user, post) => post.status === 'published' || isOwner(user, post.author_id) || isAdmin(user),
  canEditPost: (user, post) => !!user && (post.status === 'published' || isOwner(user, post.author_id) || isAdmin(user)),
  canDeletePost: (user, post) => isOwner(user, post.author_id) || isAdmin(user),
  canPinPost: (user) => isAdmin(user),

  canViewPage: (user, page) => page.status === 'published' || !!user,
  canEditPage: (user) => !!user,
  canDeletePage: (user, page) => isOwner(user, page.author_id) || isAdmin(user),

  canEditCategory: (user) => !!user,
  canDeleteCategory: (user, cat) => isOwner(user, cat.created_by) || isAdmin(user),

  canManageTags: (user) => !!user,
  canDeleteComment: (user, comment) => isOwner(user, comment.author_id) || isAdmin(user),
};
