/**
 * Forbid bare Admin SDK Firestore accessors that bypass createGetDb / createGetDbForEnv.
 */

const BARE_CALLEE_NAMES = new Set(['getFirestore']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow admin.firestore() / getFirestore() that bypass firebase-multi-env getDb helpers',
    },
    schema: [],
    messages: {
      bareAdmin:
        'Do not call admin.firestore() directly. Use createGetDb(runtime) or createGetDbForEnv(runtime) so env isolation and IAM stay aligned.',
      bareGetFirestore:
        'Do not call getFirestore() from firebase-admin directly in app code. Use createGetDb / createGetDbForEnv from firebase-multi-env.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // admin.firestore(...)
        if (
          node.callee.type === 'MemberExpression'
          && !node.callee.computed
          && node.callee.property.type === 'Identifier'
          && node.callee.property.name === 'firestore'
          && node.callee.object.type === 'Identifier'
          && node.callee.object.name === 'admin'
        ) {
          context.report({ node, messageId: 'bareAdmin' });
          return;
        }

        // getFirestore(...)
        if (
          node.callee.type === 'Identifier'
          && BARE_CALLEE_NAMES.has(node.callee.name)
        ) {
          context.report({ node, messageId: 'bareGetFirestore' });
        }
      },
    };
  },
};

export default rule;
