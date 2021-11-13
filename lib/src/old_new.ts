enum OldNewState {
  LeftOldRightNew,
  LeftNewRightOld,
}

type OldNewResult<$Type> = { old: $Type; new: $Type }

export class OldNew<$Type> {
  private state = OldNewState.LeftNewRightOld

  constructor(private left: $Type, private right: $Type) {}

  setNew(value: $Type) {
    if (this.state === OldNewState.LeftNewRightOld) {
      this.left = value
    } else {
      this.right = value
    }
  }

  get(): OldNewResult<$Type> {
    if (this.state === OldNewState.LeftNewRightOld) {
      return { old: this.right, new: this.left }
    } else {
      return { old: this.left, new: this.right }
    }
  }

  swap() {
    if (this.state === OldNewState.LeftNewRightOld) {
      this.state = OldNewState.LeftOldRightNew
    } else {
      this.state = OldNewState.LeftNewRightOld
    }
  }
}
