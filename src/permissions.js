'use strict';

// Pravidla oprávnění:
//  - příspěvek smí upravit a smazat POUZE jeho autor – ani administrátor
//    nemůže měnit ani mazat cizí příspěvky,
//  - komentáře maže autor nebo administrátor (moderace diskuze),
//  - administrátor navíc spravuje stránky, rubriky, štítky, uživatele a nastavení webu.
// Každá úprava se ukládá do historie revizí, takže ji lze vrátit.

const isAdmin = (user) => user?.role === 'admin';
const isOwner = (user, authorId) => !!user && authorId != null && user.id === authorId;

module.exports = {
  isAdmin,
  canViewPost: (user, post) => post.status === 'published' || isOwner(user, post.author_id) || isAdmin(user),
  canEditPost: (user, post) => isOwner(user, post.author_id),
  canDeletePost: (user, post) => isOwner(user, post.author_id),
  canPinPost: (user) => isAdmin(user),

  canViewPage: (user, page) => page.status === 'published' || isAdmin(user),
  canEditPage: (user) => isAdmin(user),
  canDeletePage: (user) => isAdmin(user),

  canEditCategory: (user) => isAdmin(user),
  canDeleteCategory: (user) => isAdmin(user),

  canManageTags: (user) => isAdmin(user),
  canDeleteComment: (user, comment) => isOwner(user, comment.author_id) || isAdmin(user),
};
