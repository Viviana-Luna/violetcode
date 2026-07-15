import * as React from 'react'
import { CustomApiSetup } from '../../components/CustomApiSetup.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async onDone => {
  return (
    <CustomApiSetup
      onDone={() => onDone('Provider 凭据配置已更新。')}
      onCancel={() =>
        onDone('已取消 Provider 配置。', { display: 'system' })
      }
    />
  )
}
