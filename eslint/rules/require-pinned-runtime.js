/**
 * Require createEnvRuntime({ pinned: true, ... }) for production isolation.
 */

/**
 * @param {import('estree').ObjectExpression} node
 * @returns {boolean}
 */
function hasPinnedTrue(node) {
  for (const prop of node.properties) {
    if (prop.type !== 'Property' || prop.computed) {
      continue;
    }
    const key =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'Literal'
          ? String(prop.key.value)
          : null;
    if (key !== 'pinned') {
      continue;
    }
    if (prop.value.type === 'Literal' && prop.value.value === true) {
      return true;
    }
  }
  return false;
}

/**
 * @param {import('estree').ObjectExpression} node
 * @returns {boolean}
 */
function hasAllowUnpinned(node) {
  for (const prop of node.properties) {
    if (prop.type !== 'Property' || prop.computed) {
      continue;
    }
    const key =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'Literal'
          ? String(prop.key.value)
          : null;
    if (key !== 'allowUnpinnedCloudDeploy') {
      continue;
    }
    if (prop.value.type === 'Literal' && prop.value.value === true) {
      return true;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require pinned: true on createEnvRuntime (or allowUnpinnedCloudDeploy: true escape hatch)',
    },
    schema: [],
    messages: {
      requirePinned:
        'createEnvRuntime must set pinned: true for production isolation. '
        + 'Use allowUnpinnedCloudDeploy: true only for intentional shared-runtime deploys.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier'
          || node.callee.name !== 'createEnvRuntime'
        ) {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'ObjectExpression') {
          // Spreads / variables — doctor covers statically; skip noisy lint.
          return;
        }
        if (hasPinnedTrue(arg) || hasAllowUnpinned(arg)) {
          return;
        }
        context.report({ node, messageId: 'requirePinned' });
      },
    };
  },
};

export default rule;
