import {
  AST_NODE_TYPES,
  AST_TOKEN_TYPES,
  TSESTree,
} from '@typescript-eslint/experimental-utils';
import * as util from '../util';

const possibleReturnThisTypeHolders = new Set([
  AST_NODE_TYPES.TSTypeReference,
  AST_NODE_TYPES.TSThisType,
  AST_NODE_TYPES.TSFunctionType,
  AST_NODE_TYPES.TSTypeAnnotation,
]);

export default util.createRule({
  name: 'prefer-function-type',
  meta: {
    docs: {
      description:
        'Use function types instead of interfaces with call signatures',
      category: 'Best Practices',
      recommended: false,
    },
    fixable: 'code',
    messages: {
      functionTypeOverCallableType:
        "{{ type }} has only a call signature - use '{{ sigSuggestion }}' instead.",
    },
    schema: [],
    type: 'suggestion',
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.getSourceCode();

    /**
     * Get the range of the `this` which is being used as a type annotation else returns null
     * @param node The node being checked
     * @returns {Array<number> | null} the range or null if no `this` type annotation are found
     */
    function getReturnType(
      node: TSESTree.TSTypeAnnotation,
    ): Array<number> | null {
      if (!possibleReturnThisTypeHolders.has(node.type)) {
        return null;
      }

      if (node.type === AST_NODE_TYPES.TSThisType) {
        return node.range;
      }

      if (node.type === AST_NODE_TYPES.TSTypeAnnotation) {
        if (node.typeAnnotation.type === AST_NODE_TYPES.TSThisType) {
          return node.typeAnnotation.range;
        }
      }

      if (node.type === AST_NODE_TYPES.TSFunctionType) {
        return getReturnType(node?.returnType);
      }

      return null;
    }

    /**
     * Checks if there the interface has exactly one supertype that isn't named 'Function'
     * @param node The node being checked
     */
    function hasOneSupertype(node: TSESTree.TSInterfaceDeclaration): boolean {
      if (!node.extends || node.extends.length === 0) {
        return false;
      }
      if (node.extends.length !== 1) {
        return true;
      }
      const expr = node.extends[0].expression;

      return (
        expr.type !== AST_NODE_TYPES.Identifier || expr.name !== 'Function'
      );
    }

    /**
     * @param parent The parent of the call signature causing the diagnostic
     */
    function shouldWrapSuggestion(parent: TSESTree.Node | undefined): boolean {
      if (!parent) {
        return false;
      }

      switch (parent.type) {
        case AST_NODE_TYPES.TSUnionType:
        case AST_NODE_TYPES.TSIntersectionType:
        case AST_NODE_TYPES.TSArrayType:
          return true;
        default:
          return false;
      }
    }

    /**
     * @param call The call signature causing the diagnostic
     * @param parent The parent of the call
     * @returns The suggestion to report
     */
    function renderSuggestion(
      call:
        | TSESTree.TSCallSignatureDeclaration
        | TSESTree.TSConstructSignatureDeclaration,
      parent: TSESTree.Node,
    ): string {
      const start = call.range[0];
      const colonPos = call.returnType!.range[0] - start;
      const text = sourceCode.getText().slice(start, call.range[1]);
      const returnType = getReturnType(call.returnType?.typeAnnotation);
      let lhs = text.slice(0, colonPos);
      let rhs = text.slice(colonPos + 1);

      if (returnType !== null && returnType.length === 2) {
        if (
          sourceCode.getText().slice(returnType[0], returnType[1]) === 'this'
        ) {
          // safe to change
          rhs = rhs.replace('this', parent.id.name);
        }
      }

      if (call.params.length > 0) {
        call.params.forEach(param => {
          if (
            param.typeAnnotation?.typeAnnotation?.type ===
            AST_NODE_TYPES.TSThisType
          ) {
            // replacing each first occurance of `this`
            lhs = lhs.replace('this', parent.id.name);
          }
        });
      }

      let suggestion = `${lhs} =>${rhs}`;
      if (shouldWrapSuggestion(parent.parent)) {
        suggestion = `(${suggestion})`;
      }
      if (parent.type === AST_NODE_TYPES.TSInterfaceDeclaration) {
        if (typeof parent.typeParameters !== 'undefined') {
          return `type ${sourceCode
            .getText()
            .slice(
              parent.id.range[0],
              parent.typeParameters.range[1],
            )} = ${suggestion}`;
        }
        return `type ${parent.id.name} = ${suggestion}`;
      }
      return suggestion.endsWith(';') ? suggestion.slice(0, -1) : suggestion;
    }

    /**
     * @param member The TypeElement being checked
     * @param node The parent of member being checked
     */
    function checkMember(
      member: TSESTree.TypeElement,
      node: TSESTree.Node,
    ): void {
      if (
        (member.type === AST_NODE_TYPES.TSCallSignatureDeclaration ||
          member.type === AST_NODE_TYPES.TSConstructSignatureDeclaration) &&
        typeof member.returnType !== 'undefined'
      ) {
        const suggestion = renderSuggestion(member, node);
        const fixStart =
          node.type === AST_NODE_TYPES.TSTypeLiteral
            ? node.range[0]
            : sourceCode
                .getTokens(node)
                .filter(
                  token =>
                    token.type === AST_TOKEN_TYPES.Keyword &&
                    token.value === 'interface',
                )[0].range[0];

        context.report({
          node: member,
          messageId: 'functionTypeOverCallableType',
          data: {
            type:
              node.type === AST_NODE_TYPES.TSTypeLiteral
                ? 'Type literal'
                : 'Interface',
            sigSuggestion: suggestion,
          },
          fix(fixer) {
            return fixer.replaceTextRange(
              [fixStart, node.range[1]],
              suggestion,
            );
          },
        });
      }
    }

    return {
      TSInterfaceDeclaration(node): void {
        if (!hasOneSupertype(node) && node.body.body.length === 1) {
          checkMember(node.body.body[0], node);
        }
      },
      'TSTypeLiteral[members.length = 1]'(node: TSESTree.TSTypeLiteral): void {
        checkMember(node.members[0], node);
      },
    };
  },
});
